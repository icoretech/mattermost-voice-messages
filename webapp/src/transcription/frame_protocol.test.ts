import {
  isTranscriptionFrameHandshake,
  parseTranscriptionFrameRequest,
  parseTranscriptionFrameResponse,
} from "./frame_protocol";

describe("transcription frame protocol", () => {
  it("accepts a recording with supported model options", () => {
    const blob = new Blob(["audio"], { type: "audio/webm" });
    const request = {
      type: "start",
      blob,
      mimeType: "audio/webm",
      options: {
        model: "whisper-base",
        quantization: "hybrid",
        language: "ko",
      },
    };

    const parsed = parseTranscriptionFrameRequest(request);

    expect(parsed).toEqual(request);
  });

  it.each([
    {
      model: "https://example.com/model",
      quantization: "hybrid",
      language: "ko",
    },
    { model: "whisper-base", quantization: "unsupported", language: "ko" },
    { model: "whisper-base", quantization: "hybrid", language: 42 },
  ])("rejects unsupported transcription options: %j", (options) => {
    const request = {
      type: "start",
      blob: new Blob(["audio"]),
      mimeType: "audio/webm",
      options,
    };

    const parsed = parseTranscriptionFrameRequest(request);

    expect(parsed).toBeNull();
  });

  it.each([null, "audio", { size: 5, type: "audio/webm" }])(
    "rejects recording values that are not browser Blobs: %j",
    (blob) => {
      const request = {
        type: "start",
        blob,
        mimeType: "audio/webm",
        options: {
          model: "whisper-tiny",
          quantization: "hybrid",
          language: "",
        },
      };

      const parsed = parseTranscriptionFrameRequest(request);

      expect(parsed).toBeNull();
    },
  );

  it.each([
    { type: "voice-transcription-connect", version: 1, accepted: true },
    { type: "voice-transcription-connect", version: 2, accepted: false },
    { type: "other-connect", version: 1, accepted: false },
  ])(
    "requires the supported handshake type and version: %j",
    ({ accepted, ...handshake }) => {
      const result = isTranscriptionFrameHandshake(handshake);

      expect(result).toBe(accepted);
    },
  );

  it.each([
    { stage: "transcribing", progress: Number.NaN },
    { stage: "transcribing", progress: Number.POSITIVE_INFINITY },
    { stage: "transcribing", progress: -1 },
    { stage: "transcribing", progress: 2 },
    { stage: "unknown", progress: 0.5 },
  ])("rejects invalid progress from the frame: %j", (progress) => {
    const message = { type: "progress", progress };

    const parsed = parseTranscriptionFrameResponse(message);

    expect(parsed).toBeNull();
  });

  it("preserves a backend error and its error type", () => {
    const message = {
      type: "error",
      name: "ModelLoadError",
      message: "WebGPU unavailable",
    };

    const parsed = parseTranscriptionFrameResponse(message);

    expect(parsed).toEqual(message);
  });

  it("accepts explicit cancellation without requiring a recording", () => {
    const parsed = parseTranscriptionFrameRequest({ type: "cancel" });

    expect(parsed).toEqual({ type: "cancel" });
  });
});
