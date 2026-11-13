import type {
  ClientTranscriptionModel,
  ClientTranscriptionQuantization,
} from "../plugin/manifest";
import { transcribeVoiceMessageBlobInFrame } from "./transcription_frame";
import { transcribeVoiceMessageBlobDirect } from "./transcription_runtime";

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

export async function transcribeVoiceMessageBlob(
  blob: Blob,
  mimeType: string,
  options: LocalTranscriptionOptions,
): Promise<string> {
  if (globalThis.crossOriginIsolated !== true) {
    return transcribeVoiceMessageBlobInFrame(blob, mimeType, options);
  }

  return transcribeVoiceMessageBlobDirect(blob, mimeType, options);
}
