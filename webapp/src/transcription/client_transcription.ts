import type {
  ClientTranscriptionModel,
  ClientTranscriptionQuantization,
} from "../plugin/manifest";

export type LocalTranscriptionProgress = {
  stage: "loading" | "decoding" | "transcribing" | "done";
  progress: number;
};

export type LocalTranscriptionOptions = {
  model: ClientTranscriptionModel;
  quantization: ClientTranscriptionQuantization;
  language: string;
  signal?: AbortSignal;
  onProgress?: (progress: LocalTranscriptionProgress) => void;
  onText?: (text: string) => void;
};

type TranscriptSegmentLike = {
  text?: unknown;
};

function normalizeTranscriptText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("Transcription cancelled", "AbortError");
  }

  const error = new Error("Transcription cancelled");
  error.name = "AbortError";
  return error;
}

export async function transcribeVoiceMessageBlob(
  blob: Blob,
  mimeType: string,
  options: LocalTranscriptionOptions,
): Promise<string> {
  if (globalThis.crossOriginIsolated !== true) {
    throw new Error(
      "Local transcription requires Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp on the Mattermost site",
    );
  }

  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const { BrowserWhisper, MODELS } = await import("browser-whisper");
  const whisper = new BrowserWhisper({
    model: options.model,
    quantization: options.quantization,
    ...(MODELS[options.model].capabilities.language && options.language
      ? { language: options.language }
      : {}),
  });
  const segmentTexts: string[] = [];
  const seenSegments = new WeakSet<object>();

  let stream: Pick<
    ReturnType<InstanceType<typeof BrowserWhisper>["transcribe"]>,
    "collect" | "cancel"
  > | null = null;
  let audioContext: AudioContext | undefined;
  let active = true;

  const updateTextFromSegment = (segment: TranscriptSegmentLike) => {
    if (!active || options.signal?.aborted) return;
    if (typeof segment === "object" && segment !== null) {
      if (seenSegments.has(segment)) {
        return;
      }
      seenSegments.add(segment);
    }

    if (typeof segment.text !== "string" || segment.text.trim() === "") {
      return;
    }

    segmentTexts.push(segment.text);
    options.onText?.(normalizeTranscriptText(segmentTexts.join(" ")));
  };

  let abortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortListener = () => {
      stream?.cancel();
      reject(createAbortError());
    };

    options.signal?.addEventListener("abort", abortListener, { once: true });
  });

  try {
    if (options.signal?.aborted) {
      abortListener?.();
    }
    const collect = async () => {
      if (!stream) return;
      const previousCount = segmentTexts.length;
      const segments = await Promise.race([stream.collect(), abortPromise]);
      if (options.signal?.aborted) throw createAbortError();
      if (segmentTexts.length === previousCount) {
        for (const segment of segments) updateTextFromSegment(segment);
      }
    };
    const callbacks = {
      onProgress: (progress: LocalTranscriptionProgress) => {
        if (active && !options.signal?.aborted) options.onProgress?.(progress);
      },
      onSegment: updateTextFromSegment,
    };
    if (MODELS[options.model].engine === "parakeet") {
      // The File decoder pads its final window to 30 seconds, which can erase
      // short Parakeet transcripts. Its PCM API accepts the actual sample count.
      audioContext = new AudioContext({ sampleRate: 16000 });
      callbacks.onProgress({ stage: "decoding", progress: 0 });
      const bytes = await Promise.race([blob.arrayBuffer(), abortPromise]);
      if (options.signal?.aborted) throw createAbortError();
      const audio = await Promise.race([
        audioContext.decodeAudioData(bytes),
        abortPromise,
      ]);
      if (options.signal?.aborted) throw createAbortError();
      const channels = Array.from(
        { length: audio.numberOfChannels },
        (_, channel) => audio.getChannelData(channel),
      );
      const windowSize = 16000 * 30;
      const processNextWindow = async (offset: number): Promise<void> => {
        if (offset >= audio.length) return;
        if (options.signal?.aborted) throw createAbortError();
        const end = Math.min(offset + windowSize, audio.length);
        const samples =
          channels.length === 1
            ? channels[0].subarray(offset, end)
            : new Float32Array(end - offset);
        if (channels.length > 1) {
          for (const channel of channels) {
            for (let i = offset; i < end; i++)
              samples[i - offset] += channel[i] / channels.length;
          }
        }
        stream = whisper.transcribePCM(samples, {
          ...callbacks,
          onProgress: (event) => {
            switch (event.stage) {
              case "loading":
              case "decoding":
                if (offset === 0) callbacks.onProgress(event);
                break;
              case "transcribing":
              case "done":
                callbacks.onProgress({
                  stage: "transcribing",
                  progress:
                    (offset + samples.length * event.progress) / audio.length,
                });
                break;
            }
          },
        });
        await collect();
        await processNextWindow(end);
      };
      await processNextWindow(0);
      callbacks.onProgress({ stage: "done", progress: 1 });
    } else {
      const file = new File([blob], "voice-message.webm", { type: mimeType });
      stream = whisper.transcribe(file, callbacks);
      if (options.signal?.aborted) abortListener?.();
      await collect();
    }

    return normalizeTranscriptText(segmentTexts.join(" "));
  } finally {
    active = false;
    if (abortListener) {
      options.signal?.removeEventListener("abort", abortListener);
    }
    whisper.dispose();
    await audioContext?.close();
  }
}
