import type { FileInfo } from "@mattermost/types/files";
import type { Post } from "@mattermost/types/posts";
import { getSiteBasePath } from "./site_base_path";

export type UploadVoiceMessageInput = {
  blob: Blob;
  channelId: string;
  rootId?: string;
  durationMs: number;
  mimeType: string;
  waveform?: number[];
  transcript?: string;
  signal?: AbortSignal;
};

export type UploadVoiceMessageResponse = {
  post: Post;
  file_info: FileInfo;
};

export async function uploadVoiceMessage(
  input: UploadVoiceMessageInput,
): Promise<UploadVoiceMessageResponse> {
  const formData = new FormData();
  if (typeof File === "function") {
    formData.append(
      "audio",
      new File([input.blob], "voice-message.webm", { type: input.mimeType }),
    );
  } else {
    formData.append("audio", input.blob, "voice-message.webm");
  }

  formData.append("channel_id", input.channelId);
  if (input.rootId) {
    formData.append("root_id", input.rootId);
  }
  formData.append("duration_ms", String(Math.round(input.durationMs)));
  if (input.waveform) {
    formData.append("waveform", JSON.stringify(input.waveform));
  }
  const transcript = input.transcript?.trim();
  if (transcript) {
    formData.append("transcript", transcript);
  }

  const response = await fetch(
    `${getSiteBasePath()}/plugins/ch.icorete.mattermost-voice-messages/api/v1/voice-messages`,
    {
      method: "POST",
      body: formData,
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
      signal: input.signal,
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Could not send voice message");
  }

  return (await response.json()) as UploadVoiceMessageResponse;
}
