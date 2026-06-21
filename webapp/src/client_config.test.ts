import {
  defaultClientConfig,
  loadClientConfig,
  resetClientConfigCacheForTests,
} from "./client_config";

describe("client config", () => {
  beforeEach(() => {
    resetClientConfigCacheForTests();
    window.basename = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetClientConfigCacheForTests();
  });

  it("maps successful snake_case responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          voice_messages_enabled: false,
          uploaded_audio_preview_enabled: false,
          client_transcription_enabled: true,
          client_transcription_auto_start: true,
          client_transcription_model: "whisper-base",
          client_transcription_quantization: "q4",
          client_transcription_language: " it ",
        }),
      ),
    );

    await expect(loadClientConfig()).resolves.toEqual({
      voiceMessagesEnabled: false,
      uploadedAudioPreviewEnabled: false,
      clientTranscriptionEnabled: true,
      clientTranscriptionAutoStart: true,
      clientTranscriptionModel: "whisper-base",
      clientTranscriptionQuantization: "q4",
      clientTranscriptionLanguage: "it",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/plugins/ch.icorete.mattermost-voice-messages/api/v1/config",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }),
    );
  });

  it("falls back for invalid or missing fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          voice_messages_enabled: "yes",
          client_transcription_enabled: true,
          client_transcription_model: "unknown",
          client_transcription_quantization: "int8",
          client_transcription_language: 42,
        }),
      ),
    );

    await expect(loadClientConfig()).resolves.toEqual({
      ...defaultClientConfig,
      clientTranscriptionEnabled: true,
    });
  });

  it("throws non-ok response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("blocked", { status: 403 })),
    );

    await expect(loadClientConfig()).rejects.toThrow("blocked");
  });

  it("resetClientConfigCacheForTests isolates cached responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ voice_messages_enabled: false }))
        .mockResolvedValueOnce(Response.json({ voice_messages_enabled: true })),
    );

    await expect(loadClientConfig()).resolves.toMatchObject({
      voiceMessagesEnabled: false,
    });
    resetClientConfigCacheForTests();
    await expect(loadClientConfig()).resolves.toMatchObject({
      voiceMessagesEnabled: true,
    });
  });
});
