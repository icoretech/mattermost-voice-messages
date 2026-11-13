import { getSiteBasePath } from "../api/site_base_path";
import manifest from "../plugin/manifest";
import type { LocalTranscriptionOptions } from "./client_transcription";
import {
  parseTranscriptionFrameResponse,
  transcriptionFrameHandshake,
} from "./frame_protocol";

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("Transcription cancelled", "AbortError");
  }

  const error = new Error("Transcription cancelled");
  error.name = "AbortError";
  return error;
}

function frameUrl(): string {
  const version = encodeURIComponent(String(manifest.version));
  return `${getSiteBasePath()}/static/plugins/${manifest.id}/transcription-frame.html?v=${version}`;
}

function createFrame(): HTMLIFrameElement {
  if (!document.body) {
    throw new Error(
      "Cannot start local transcription before the document body exists",
    );
  }

  const frame = document.createElement("iframe");
  frame.src = frameUrl();
  frame.hidden = true;
  frame.title = "Local transcription runtime";
  frame.setAttribute("aria-hidden", "true");
  document.body.append(frame);
  return frame;
}

function waitForFrameReady(
  frame: HTMLIFrameElement,
  parentPort: MessagePort,
  framePort: MessagePort,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortListener);
      callback();
    };
    const abortListener = () => finish(() => reject(createAbortError()));
    const timeout = setTimeout(() => {
      finish(() =>
        reject(new Error("Local transcription runtime did not start")),
      );
    }, 15_000);
    signal?.addEventListener("abort", abortListener, { once: true });

    parentPort.onmessage = (event: MessageEvent<unknown>) => {
      const response = parseTranscriptionFrameResponse(event.data);
      if (response?.type !== "ready") return;
      finish(resolve);
    };
    parentPort.start();

    frame.addEventListener(
      "load",
      () => {
        if (signal?.aborted) return;
        frame.contentWindow?.postMessage(
          transcriptionFrameHandshake,
          window.location.origin,
          [framePort],
        );
      },
      { once: true },
    );
  });
}

export async function transcribeVoiceMessageBlobInFrame(
  blob: Blob,
  mimeType: string,
  options: LocalTranscriptionOptions,
): Promise<string> {
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const frame = createFrame();
  const channel = new MessageChannel();
  const parentPort = channel.port1;
  const framePort = channel.port2;
  let abortListener: (() => void) | undefined;

  try {
    await waitForFrameReady(frame, parentPort, framePort, options.signal);
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    return await new Promise<string>((resolve, reject) => {
      parentPort.onmessage = (event: MessageEvent<unknown>) => {
        const response = parseTranscriptionFrameResponse(event.data);
        if (!response) return;
        switch (response.type) {
          case "ready":
            return;
          case "progress":
            options.onProgress?.(response.progress);
            return;
          case "text":
            options.onText?.(response.text);
            return;
          case "result":
            resolve(response.text);
            return;
          case "error": {
            const error = new Error(response.message);
            error.name = response.name;
            reject(error);
            return;
          }
        }
      };

      abortListener = () => {
        parentPort.postMessage({ type: "cancel" });
        reject(createAbortError());
      };
      options.signal?.addEventListener("abort", abortListener, { once: true });

      parentPort.postMessage({
        type: "start",
        blob,
        mimeType,
        options: {
          model: options.model,
          quantization: options.quantization,
          language: options.language,
        },
      });
    });
  } finally {
    if (abortListener) {
      options.signal?.removeEventListener("abort", abortListener);
    }
    parentPort.close();
    frame.remove();
  }
}
