import type { Post } from "@mattermost/types/posts";
import { normalizeWaveformPeaks, type WaveformPeaks } from "./audio/waveform";

type RawVoiceMessageProps = Record<string, unknown>;

export type VoiceMessageProps = {
  fileId?: string;
  durationMs?: number;
  waveform?: WaveformPeaks;
};

function getRawVoiceMessageProps(
  post?: Pick<Post, "props">,
): RawVoiceMessageProps | undefined {
  const voiceMessage = post?.props?.voice_message;
  if (
    !voiceMessage ||
    typeof voiceMessage !== "object" ||
    Array.isArray(voiceMessage)
  ) {
    return undefined;
  }

  return voiceMessage as RawVoiceMessageProps;
}

export function hasVoiceMessageProps(post?: Pick<Post, "props">): boolean {
  return getRawVoiceMessageProps(post) !== undefined;
}

export function getVoiceMessageProps(
  post?: Pick<Post, "props">,
): VoiceMessageProps | undefined {
  const voiceMessage = getRawVoiceMessageProps(post);
  if (!voiceMessage) {
    return undefined;
  }

  return {
    fileId:
      typeof voiceMessage.file_id === "string"
        ? voiceMessage.file_id
        : undefined,
    durationMs:
      typeof voiceMessage.duration_ms === "number"
        ? voiceMessage.duration_ms
        : undefined,
    waveform: normalizeWaveformPeaks(voiceMessage.waveform),
  };
}
