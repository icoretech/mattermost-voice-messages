import type { Post } from "@mattermost/types/posts";
import React from "react";
import { getMattermostFileUrl } from "../audio/file_url";
import { getVoiceMessageProps } from "../voice_message_props";
import { VoiceAudioPlayer } from "./voice_audio_player";

type VoicePostComponentProps = {
  post: Post;
  compactDisplay?: boolean;
  isRHS?: boolean;
  theme?: Record<string, string>;
};

export function VoicePostComponent({
  post,
  compactDisplay = false,
  isRHS = false,
}: VoicePostComponentProps) {
  const voiceMessage = getVoiceMessageProps(post);
  const fileId = voiceMessage?.fileId || post.file_ids?.[0] || "";
  const durationMs = voiceMessage?.durationMs ?? 0;
  const waveform = voiceMessage?.waveform;
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
