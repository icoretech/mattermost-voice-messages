import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  defaultClientConfig,
  loadClientConfig,
  useVoiceMessagesClientConfig,
} from "./client_config";

describe("client config", () => {
  beforeEach(() => {
    window.basename = "";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("fetches fresh responses for each load", async () => {
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
    await expect(loadClientConfig()).resolves.toMatchObject({
      voiceMessagesEnabled: true,
    });
  });
  it("loads configuration into the hook and clears loading state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ voice_messages_enabled: false })),
    );
    const { result } = renderHook(() => useVoiceMessagesClientConfig());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config.voiceMessagesEnabled).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("aborts configuration requests when the hook unmounts", async () => {
    const response = Promise.withResolvers<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response.promise),
    );
    const { result, unmount } = renderHook(() =>
      useVoiceMessagesClientConfig(),
    );
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      response.resolve(Response.json({ voice_messages_enabled: false })),
    );
    expect(result.current.loading).toBe(true);
    expect(result.current.config).toBe(defaultClientConfig);
  });

  it("leaves loading state and preserves defaults when configuration fails", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("configuration unavailable", { status: 503 }),
      ),
    );
    const { result } = renderHook(() => useVoiceMessagesClientConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toBe(defaultClientConfig);
    expect(result.current.error).toBe("configuration unavailable");
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
