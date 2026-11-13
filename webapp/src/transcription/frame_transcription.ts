import type { LocalTranscriptionProgress } from "./client_transcription";
import type { TranscriptionFrameOptions } from "./frame_protocol";
import { transcribeVoiceMessageBlobDirect } from "./transcription_runtime";

type FrameRuntimeOptions = TranscriptionFrameOptions & {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LocalTranscriptionProgress) => void;
  readonly onText?: (text: string) => void;
};

export function transcribeInFrame(
  blob: Blob,
  mimeType: string,
  options: FrameRuntimeOptions,
): Promise<string> {
  return transcribeVoiceMessageBlobDirect(blob, mimeType, options);
}
