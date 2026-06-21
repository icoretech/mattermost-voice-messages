export const preferredAudioMimeTypes = [
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
] as const;

export function selectAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  return preferredAudioMimeTypes.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );
}

export function isRecordingSupported(): boolean {
  return Boolean(
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined",
  );
}
