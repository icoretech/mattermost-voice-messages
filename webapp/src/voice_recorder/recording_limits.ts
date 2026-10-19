import type { VoiceMessagesClientConfig } from "../api/client_config";
import { minVoiceMessageDurationMs } from "../constants";

export function formatRecordingBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
    : `${(bytes / 1024).toFixed(1)} KiB`;
}

export function recordingLimitError(
  bytes: number,
  durationMs: number,
  limits: VoiceMessagesClientConfig,
): string {
  if (bytes > limits.maxVoiceMessageBytes) {
    return `Recording exceeds the ${formatRecordingBytes(limits.maxVoiceMessageBytes)} size limit. Download it to keep a copy, then record a shorter message.`;
  }
  if (durationMs < minVoiceMessageDurationMs) {
    return "Recording is too short. Record at least 0.5 seconds.";
  }
  if (
    limits.maxRecordingDurationMs > 0 &&
    durationMs > limits.maxRecordingDurationMs
  ) {
    return "Recording exceeds the duration limit. Download it to keep a copy, then record a shorter message.";
  }
  return "";
}
