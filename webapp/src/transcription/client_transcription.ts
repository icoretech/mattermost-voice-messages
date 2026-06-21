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

  const { BrowserWhisper } = await import("browser-whisper");
  const whisper = new BrowserWhisper({
    model: options.model,
    quantization: options.quantization,
    language: options.language || undefined,
  });
  const file = new File([blob], "voice-message.webm", { type: mimeType });
  const segmentTexts: string[] = [];
  const seenSegments = new WeakSet<object>();

  let stream: ReturnType<
    InstanceType<typeof BrowserWhisper>["transcribe"]
  > | null = null;

  const updateTextFromSegment = (segment: TranscriptSegmentLike) => {
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
    stream = whisper.transcribe(file, {
      onProgress: options.onProgress,
      onSegment: updateTextFromSegment,
    });
    if (options.signal?.aborted) {
      abortListener?.();
    }

    const collectedSegments = await Promise.race([
      stream.collect(),
      abortPromise,
    ]);
    if (segmentTexts.length === 0) {
      for (const segment of collectedSegments) {
        updateTextFromSegment(segment);
      }
    }

    return normalizeTranscriptText(segmentTexts.join(" "));
  } finally {
    if (abortListener) {
      options.signal?.removeEventListener("abort", abortListener);
    }
    whisper.dispose();
  }
}
