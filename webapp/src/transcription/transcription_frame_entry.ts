import {
  isTranscriptionFrameHandshake,
  parseTranscriptionFrameRequest,
  type TranscriptionFrameRequest,
  type TranscriptionFrameResponse,
} from "./frame_protocol";
import { transcribeInFrame } from "./frame_transcription";

function connect(event: MessageEvent<unknown>): void {
  if (
    window.parent === window ||
    event.source !== window.parent ||
    event.origin !== window.location.origin ||
    !isTranscriptionFrameHandshake(event.data) ||
    event.ports.length !== 1
  ) {
    return;
  }
  const port = event.ports[0];
  if (!port) return;
  window.removeEventListener("message", connect);
  const controller = new AbortController();
  let started = false;
  let finished = false;
  const send = (response: TranscriptionFrameResponse) => {
    if (!finished) port.postMessage(response);
  };
  const cleanup = () => {
    finished = true;
    controller.abort();
    port.close();
    window.removeEventListener("pagehide", cleanup);
  };
  window.addEventListener("pagehide", cleanup, { once: true });
  const run = async (
    request: Extract<TranscriptionFrameRequest, { type: "start" }>,
  ) => {
    try {
      const text = await transcribeInFrame(request.blob, request.mimeType, {
        ...request.options,
        signal: controller.signal,
        onProgress: (progress) => send({ type: "progress", progress }),
        onText: (text) => send({ type: "text", text }),
      });
      send({ type: "result", text });
    } catch (error) {
      send({
        type: "error",
        name: error instanceof Error ? error.name : "Error",
        message:
          error instanceof Error
            ? error.message
            : "Could not transcribe voice message",
      });
    } finally {
      cleanup();
    }
  };
  port.onmessage = (message: MessageEvent<unknown>) => {
    if (finished) return;
    const request = parseTranscriptionFrameRequest(message.data);
    if (!request) {
      send({
        type: "error",
        name: "TypeError",
        message: "Invalid transcription request",
      });
      cleanup();
      return;
    }
    switch (request.type) {
      case "cancel":
        send({
          type: "error",
          name: "AbortError",
          message: "Transcription cancelled",
        });
        cleanup();
        return;
      case "start":
        if (started) {
          send({
            type: "error",
            name: "InvalidStateError",
            message: "Transcription already started",
          });
          cleanup();
          return;
        }
        started = true;
        void run(request);
        return;
      default: {
        const exhaustive: never = request;
        return exhaustive;
      }
    }
  };
  port.onmessageerror = () => {
    send({
      type: "error",
      name: "DataCloneError",
      message: "Could not read transcription request",
    });
    cleanup();
  };
  port.start();
  send({ type: "ready" });
}

window.addEventListener("message", connect);
