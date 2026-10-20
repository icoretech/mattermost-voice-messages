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

function getCsrfToken(): string {
  for (const cookie of document.cookie.split(";")) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith("MMCSRF=")) {
      return trimmed.slice("MMCSRF=".length);
    }
  }
  return "";
}

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

  // A session token prevents Mattermost's CSRF fallback from reading and
  // limiting the multipart body before the plugin's upload limits apply.
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
  };
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(
    `${getSiteBasePath()}/plugins/ch.icorete.mattermost-voice-messages/api/v1/voice-messages`,
    {
      method: "POST",
      body: formData,
      credentials: "same-origin",
      headers,
      signal: input.signal,
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Could not send voice message");
  }

  return (await response.json()) as UploadVoiceMessageResponse;
}
