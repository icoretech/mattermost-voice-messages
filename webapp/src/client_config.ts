import { useEffect, useState } from "react";
import { getSiteBasePath } from "./site_base_path";

export type ClientTranscriptionModel =
  | "whisper-tiny"
  | "whisper-base"
  | "whisper-small"
  | "whisper-tiny_timestamped"
  | "whisper-base_timestamped"
  | "whisper-small_timestamped"
  | "whisper-large-v3-turbo"
  | "whisper-large-v3-turbo_timestamped"
  | "whisper-large-v3"
  | "lite-whisper-large-v3-turbo-fast"
  | "lite-whisper-large-v3-turbo"
  | "lite-whisper-large-v3-turbo-acc"
  | "moonshine-tiny"
  | "moonshine-base"
  | "distil-whisper-small";

export type ClientTranscriptionQuantization =
  | "hybrid"
  | "q4"
  | "q8"
  | "fp16"
  | "fp32";

export type VoiceMessagesClientConfig = {
  voiceMessagesEnabled: boolean;
  uploadedAudioPreviewEnabled: boolean;
  clientTranscriptionEnabled: boolean;
  clientTranscriptionAutoStart: boolean;
  clientTranscriptionModel: ClientTranscriptionModel;
  clientTranscriptionQuantization: ClientTranscriptionQuantization;
  clientTranscriptionLanguage: string;
};

type ServerVoiceMessagesClientConfig = {
  voice_messages_enabled?: unknown;
  uploaded_audio_preview_enabled?: unknown;
  client_transcription_enabled?: unknown;
  client_transcription_auto_start?: unknown;
  client_transcription_model?: unknown;
  client_transcription_quantization?: unknown;
  client_transcription_language?: unknown;
};

const clientTranscriptionModels = new Set<ClientTranscriptionModel>([
  "whisper-tiny",
  "whisper-base",
  "whisper-small",
  "whisper-tiny_timestamped",
  "whisper-base_timestamped",
  "whisper-small_timestamped",
  "whisper-large-v3-turbo",
  "whisper-large-v3-turbo_timestamped",
  "whisper-large-v3",
  "lite-whisper-large-v3-turbo-fast",
  "lite-whisper-large-v3-turbo",
  "lite-whisper-large-v3-turbo-acc",
  "moonshine-tiny",
  "moonshine-base",
  "distil-whisper-small",
]);

const clientTranscriptionQuantizations =
  new Set<ClientTranscriptionQuantization>([
    "hybrid",
    "q4",
    "q8",
    "fp16",
    "fp32",
  ]);

export const defaultClientConfig: VoiceMessagesClientConfig = {
  voiceMessagesEnabled: true,
  uploadedAudioPreviewEnabled: true,
  clientTranscriptionEnabled: false,
  clientTranscriptionAutoStart: false,
  clientTranscriptionModel: "whisper-tiny",
  clientTranscriptionQuantization: "hybrid",
  clientTranscriptionLanguage: "",
};

let clientConfigPromise: Promise<VoiceMessagesClientConfig> | null = null;

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function modelOrDefault(value: unknown): ClientTranscriptionModel {
  if (
    typeof value === "string" &&
    clientTranscriptionModels.has(value as ClientTranscriptionModel)
  ) {
    return value as ClientTranscriptionModel;
  }
  return defaultClientConfig.clientTranscriptionModel;
}

function quantizationOrDefault(
  value: unknown,
): ClientTranscriptionQuantization {
  if (
    typeof value === "string" &&
    clientTranscriptionQuantizations.has(
      value as ClientTranscriptionQuantization,
    )
  ) {
    return value as ClientTranscriptionQuantization;
  }
  return defaultClientConfig.clientTranscriptionQuantization;
}

function languageOrDefault(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : defaultClientConfig.clientTranscriptionLanguage;
}

function mapClientConfig(
  payload: ServerVoiceMessagesClientConfig,
): VoiceMessagesClientConfig {
  return {
    voiceMessagesEnabled: booleanOrDefault(
      payload.voice_messages_enabled,
      defaultClientConfig.voiceMessagesEnabled,
    ),
    uploadedAudioPreviewEnabled: booleanOrDefault(
      payload.uploaded_audio_preview_enabled,
      defaultClientConfig.uploadedAudioPreviewEnabled,
    ),
    clientTranscriptionEnabled: booleanOrDefault(
      payload.client_transcription_enabled,
      defaultClientConfig.clientTranscriptionEnabled,
    ),
    clientTranscriptionAutoStart: booleanOrDefault(
      payload.client_transcription_auto_start,
      defaultClientConfig.clientTranscriptionAutoStart,
    ),
    clientTranscriptionModel: modelOrDefault(
      payload.client_transcription_model,
    ),
    clientTranscriptionQuantization: quantizationOrDefault(
      payload.client_transcription_quantization,
    ),
    clientTranscriptionLanguage: languageOrDefault(
      payload.client_transcription_language,
    ),
  };
}

export function resetClientConfigCacheForTests(): void {
  clientConfigPromise = null;
}

export function loadClientConfig(
  signal?: AbortSignal,
): Promise<VoiceMessagesClientConfig> {
  if (clientConfigPromise) {
    return clientConfigPromise;
  }

  const promise = fetch(
    `${getSiteBasePath()}/plugins/ch.icorete.mattermost-voice-messages/api/v1/config`,
    {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
      signal,
    },
  ).then(async (response) => {
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || "Could not load voice message settings");
    }

    return mapClientConfig(
      (await response.json()) as ServerVoiceMessagesClientConfig,
    );
  });

  clientConfigPromise = promise;
  promise.catch(() => {
    if (clientConfigPromise === promise) {
      clientConfigPromise = null;
    }
  });

  return promise;
}

export function useVoiceMessagesClientConfig(): {
  config: VoiceMessagesClientConfig;
  loading: boolean;
  error: string;
} {
  const [config, setConfig] = useState(defaultClientConfig);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;

    loadClientConfig(abortController.signal)
      .then((loadedConfig) => {
        if (!active) {
          return;
        }
        setConfig(loadedConfig);
        setError("");
      })
      .catch((configError: unknown) => {
        if (!active || abortController.signal.aborted) {
          return;
        }
        const message =
          configError instanceof Error
            ? configError.message
            : "Could not load voice message settings";
        console.warn(
          "[mattermost-voice-messages] Could not load plugin configuration",
          configError,
        );
        setConfig(defaultClientConfig);
        setError(message);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      abortController.abort();
    };
  }, []);

  return { config, loading, error };
}
