import {
  type ClientTranscriptionModel,
  type ClientTranscriptionQuantization,
  clientTranscriptionModels,
  clientTranscriptionQuantizations,
} from "../plugin/manifest";

export const transcriptionFrameHandshake = {
  type: "voice-transcription-connect",
  version: 1,
} as const;

export type TranscriptionFrameOptions = {
  readonly model: ClientTranscriptionModel;
  readonly quantization: ClientTranscriptionQuantization;
  readonly language: string;
};

export type TranscriptionFrameProgress = {
  readonly stage: "loading" | "decoding" | "transcribing" | "done";
  readonly progress: number;
};

export type TranscriptionFrameRequest =
  | {
      readonly type: "start";
      readonly blob: Blob;
      readonly mimeType: string;
      readonly options: TranscriptionFrameOptions;
    }
  | { readonly type: "cancel" };

export type TranscriptionFrameResponse =
  | { readonly type: "ready" }
  | {
      readonly type: "progress";
      readonly progress: TranscriptionFrameProgress;
    }
  | { readonly type: "text" | "result"; readonly text: string }
  | {
      readonly type: "error";
      readonly name: string;
      readonly message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isTranscriptionFrameHandshake(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === transcriptionFrameHandshake.type &&
    value.version === transcriptionFrameHandshake.version
  );
}

export function parseTranscriptionFrameRequest(
  value: unknown,
): TranscriptionFrameRequest | null {
  if (!isRecord(value)) return null;
  if (value.type === "cancel") return { type: "cancel" };
  if (
    value.type !== "start" ||
    !(value.blob instanceof Blob) ||
    typeof value.mimeType !== "string" ||
    !isRecord(value.options) ||
    typeof value.options.language !== "string"
  ) {
    return null;
  }
  const options = value.options;
  const model = clientTranscriptionModels.find(
    (candidate) => candidate === options.model,
  );
  const quantization = clientTranscriptionQuantizations.find(
    (candidate) => candidate === options.quantization,
  );
  if (!model || !quantization) return null;
  return {
    type: "start",
    blob: value.blob,
    mimeType: value.mimeType,
    options: { model, quantization, language: value.options.language },
  };
}

export function parseTranscriptionFrameResponse(
  value: unknown,
): TranscriptionFrameResponse | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "ready":
      return { type: "ready" };
    case "text":
    case "result":
      return typeof value.text === "string"
        ? { type: value.type, text: value.text }
        : null;
    case "error":
      return typeof value.name === "string" && typeof value.message === "string"
        ? { type: "error", name: value.name, message: value.message }
        : null;
    case "progress": {
      const progress = value.progress;
      if (
        !isRecord(progress) ||
        typeof progress.progress !== "number" ||
        !Number.isFinite(progress.progress) ||
        progress.progress < 0 ||
        progress.progress > 1
      ) {
        return null;
      }
      switch (progress.stage) {
        case "loading":
        case "decoding":
        case "transcribing":
        case "done":
          return {
            type: "progress",
            progress: { stage: progress.stage, progress: progress.progress },
          };
        default:
          return null;
      }
    }
    default:
      return null;
  }
}
