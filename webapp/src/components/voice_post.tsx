import type { Post } from "@mattermost/types/posts";
import React from "react";
import { getMattermostFileUrl } from "../file_url";
import { normalizeWaveformPeaks, type WaveformPeaks } from "../waveform";
import { VoiceAudioPlayer } from "./voice_audio_player";

type VoicePostComponentProps = {
  post: Post;
  compactDisplay?: boolean;
  isRHS?: boolean;
  theme?: Record<string, string>;
};

type VoiceMessageProps = {
  file_id?: unknown;
  duration_ms?: unknown;
  waveform?: unknown;
};

function getVoiceMessageProps(post: Post): VoiceMessageProps {
  const voiceMessage = post.props?.voice_message;
  if (!voiceMessage || typeof voiceMessage !== "object") {
    return {};
  }
  return voiceMessage as VoiceMessageProps;
}

export function VoicePostComponent({
  post,
  compactDisplay = false,
  isRHS = false,
}: VoicePostComponentProps) {
  const voiceMessage = getVoiceMessageProps(post);
  const propFileId =
    typeof voiceMessage.file_id === "string" ? voiceMessage.file_id : "";
  const fileId = propFileId || post.file_ids?.[0] || "";
  const durationMs =
    typeof voiceMessage.duration_ms === "number" ? voiceMessage.duration_ms : 0;
  const waveform: WaveformPeaks | undefined = normalizeWaveformPeaks(
    voiceMessage.waveform,
  );
  const fileUrl = fileId
    ? getMattermostFileUrl(fileId, post.update_at || 0)
    : "";

  return (
    <VoiceAudioPlayer
      src={fileUrl}
      durationMs={durationMs}
      fallbackHref={fileUrl}
      compact={compactDisplay || isRHS}
      waveform={waveform}
    />
  );
}
