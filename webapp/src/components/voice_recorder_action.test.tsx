import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  extractWaveformPeaksFromBlob,
  waveformBarCount,
} from "../audio/waveform";
import { VoiceRecorderAction } from "./voice_recorder_action";

vi.mock("../audio/waveform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../audio/waveform")>();
  return {
    ...actual,
    extractWaveformPeaksFromBlob: vi.fn(async () =>
      Array.from(
        { length: actual.waveformBarCount },
        (_, index) => index / actual.waveformBarCount,
      ),
    ),
  };
});

const browserWhisperMock = vi.hoisted(() => ({
  cancel: vi.fn(),
  dispose: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("browser-whisper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("browser-whisper")>()),
  BrowserWhisper: vi.fn(function BrowserWhisperMock(this: {
    dispose: typeof browserWhisperMock.dispose;
    transcribe: typeof browserWhisperMock.transcribe;
  }) {
    this.dispose = browserWhisperMock.dispose;
    this.transcribe = browserWhisperMock.transcribe;
  }),
}));

type FakeTrack = {
  stop: ReturnType<typeof vi.fn>;
};

type FakeMediaRecorderEvent = {
  data: Blob;
};

class FakeMediaRecorder {
  public static isTypeSupported = vi.fn(() => true);
  public static instances: FakeMediaRecorder[] = [];
  public ondataavailable: ((event: FakeMediaRecorderEvent) => void) | null =
    null;
  public onstop: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public mimeType = "audio/webm;codecs=opus";
  public state: RecordingState = "inactive";
  public stopDelayMs = 0;
  public timeslice: number | undefined;
  public finalChunk = "voice-data";

  public emitChunk(size: number) {
    this.ondataavailable?.({
      data: new Blob([new Uint8Array(size)], { type: this.mimeType }),
    });
  }

  public constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeMediaRecorder.instances.push(this);
  }

  public start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = "recording";
  }

  public stop() {
    this.state = "inactive";
    const emitStop = () => {
      this.ondataavailable?.({
        data: new Blob([this.finalChunk], { type: this.mimeType }),
      });
      this.onstop?.();
    };

    if (this.stopDelayMs > 0) {
      window.setTimeout(emitStop, this.stopDelayMs);
      return;
    }

    emitStop();
  }
}

type ServerClientConfig = {
  max_voice_message_bytes: number;
  max_recording_duration_ms: number;
  voice_messages_enabled: boolean;
  uploaded_audio_preview_enabled: boolean;
  client_transcription_enabled: boolean;
  client_transcription_auto_start: boolean;
  client_transcription_model: string;
  client_transcription_quantization: string;
  client_transcription_language: string;
};

const defaultServerClientConfig: ServerClientConfig = {
  max_voice_message_bytes: 25 * 1024 * 1024,
  max_recording_duration_ms: 21600000,
  voice_messages_enabled: true,
  uploaded_audio_preview_enabled: true,
  client_transcription_enabled: false,
  client_transcription_auto_start: false,
  client_transcription_model: "whisper-tiny",
  client_transcription_quantization: "hybrid",
  client_transcription_language: "",
};

function defaultUploadResponse() {
  return Response.json(
    {
      post: { id: "post-id" },
      file_info: { id: "file-id" },
    },
    { status: 201 },
  );
}

function installFetchMock({
  config,
  uploadResponse,
}: {
  config?: Partial<ServerClientConfig>;
  uploadResponse?: () => Response | Promise<Response>;
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/v1/config")) {
        return Response.json({ ...defaultServerClientConfig, ...config });
      }

      if (init?.method === "POST") {
        return uploadResponse ? uploadResponse() : defaultUploadResponse();
      }

      return new Response("Unexpected request", { status: 404 });
    }),
  );
}

function installRecorderEnvironment(
  track: FakeTrack,
  options: Parameters<typeof installFetchMock>[0] = {},
) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
      })),
    },
  });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("crossOriginIsolated", true);
  installFetchMock(options);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice-message");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
}

function getUploadFetchCalls() {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "POST");
}

async function recordAndReview() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Record voice message" }),
  );
  expect(
    await screen.findByRole("button", { name: "Stop recording" }),
  ).toBeInTheDocument();
  Date.now = vi.fn(() => 3_000);
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  expect(
    await screen.findByRole("button", { name: "Send voice message" }),
  ).toBeInTheDocument();
}

describe("VoiceRecorderAction", () => {
  const originalMediaDevices = navigator.mediaDevices;
  const realDateNow = Date.now;
  const originalPause = HTMLMediaElement.prototype.pause;

  beforeEach(() => {
    browserWhisperMock.cancel.mockReset();
    browserWhisperMock.dispose.mockReset();
    browserWhisperMock.transcribe.mockReset();
    browserWhisperMock.transcribe.mockReturnValue({
      cancel: browserWhisperMock.cancel,
      collect: vi.fn(async () => []),
    });
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.isTypeSupported.mockReturnValue(true);
    Date.now = vi.fn(() => 1_000);
    HTMLMediaElement.prototype.pause = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Date.now = realDateNow;
    HTMLMediaElement.prototype.pause = originalPause;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  it("records, reviews, and sends voice message form data", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);
    vi.mocked(extractWaveformPeaksFromBlob).mockClear();

    render(
      <VoiceRecorderAction
        draft={{ channelId: "channel-id", rootId: "root-id" }}
      />,
    );

    await recordAndReview();
    expect(track.stop).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));

    await waitFor(() => expect(getUploadFetchCalls()).toHaveLength(1));
    const [, init] = getUploadFetchCalls()[0];
    expect(init?.credentials).toBe("same-origin");
    const formData = init?.body as FormData;
    expect(formData.get("channel_id")).toBe("channel-id");
    expect(formData.get("root_id")).toBe("root-id");
    expect(formData.get("duration_ms")).toBe("2000");
    expect(formData.has("mime_type")).toBe(false);
    expect(formData.get("audio")).toBeInstanceOf(File);
    expect(formData.get("transcript")).toBeNull();
    expect(JSON.parse(String(formData.get("waveform")))).toHaveLength(
      waveformBarCount,
    );
    expect(extractWaveformPeaksFromBlob).toHaveBeenCalledTimes(1);
  });

  it("shows only the mic icon while waiting for browser permission", async () => {
    installFetchMock();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => new Promise(() => undefined)),
      },
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );

    const pendingButton = await screen.findByRole("button", {
      name: "Cancel recording",
    });
    expect(pendingButton).toHaveTextContent("");
    expect(pendingButton.querySelector("svg")).toBeInTheDocument();
  });

  it("captures stop time before delayed recorder stop callback", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);

    render(
      <VoiceRecorderAction
        draft={{ channelId: "channel-id", rootId: "root-id" }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    await screen.findByRole("button", { name: "Stop recording" });
    FakeMediaRecorder.instances[0].stopDelayMs = 100;
    Date.now = vi.fn(() => 5_000);
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    Date.now = vi.fn(() => 1_781_815_732_000);

    expect(
      await screen.findByRole("button", { name: "Send voice message" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));

    await waitFor(() => expect(getUploadFetchCalls()).toHaveLength(1));
    const [, init] = getUploadFetchCalls()[0];
    const formData = init?.body as FormData;
    expect(formData.get("duration_ms")).toBe("4000");
  });

  it("keeps review playback and recovery after upload errors", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track, {
      uploadResponse: () =>
        new Response("Invalid duration_ms", { status: 400 }),
    });

    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);

    await recordAndReview();
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid duration_ms",
    );
    expect(
      screen.getByRole("button", { name: "Play voice message" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("link", { name: "Download recording" }),
    ).toHaveAttribute("href", "blob:voice-message");
    expect(
      screen.getByRole("button", { name: "Send voice message" }),
    ).toBeEnabled();
  });

  it("stops tracks when recording is cancelled", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);

    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    expect(
      await screen.findByRole("button", { name: "Stop recording" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(getUploadFetchCalls()).toHaveLength(0);
  });

  it("stops tracks when unmounted during recording", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);

    const { unmount } = render(
      <VoiceRecorderAction draft={{ channelId: "channel-id" }} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    expect(
      await screen.findByRole("button", { name: "Stop recording" }),
    ).toBeInTheDocument();
    unmount();

    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("hides recorder when voice messages are disabled", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track, {
      config: { voice_messages_enabled: false },
    });

    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "Record voice message" }),
    ).not.toBeInTheDocument();
  });

  it("does not send transcripts when transcription is disabled", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);

    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);

    await recordAndReview();
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));

    await waitFor(() => expect(getUploadFetchCalls()).toHaveLength(1));
    const [, init] = getUploadFetchCalls()[0];
    expect((init?.body as FormData | undefined)?.get("transcript")).toBeNull();
  });

  it.each(["parakeet-ctc-0.6b", "parakeet-tdt-0.6b-v3"])(
    "keeps %s review focused on recording controls without model credits",
    async (model) => {
      // Given local transcription configured with a Parakeet model.
      installRecorderEnvironment(
        { stop: vi.fn() },
        {
          config: {
            client_transcription_enabled: true,
            client_transcription_model: model,
          },
        },
      );
      render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);

      // When the recording reaches review, before inference is requested.
      await recordAndReview();

      // Then review exposes its actions without attribution or license links.
      for (const name of [
        "Play voice message",
        "Transcribe voice message locally",
        "Send voice message",
        "Cancel recording",
      ]) {
        expect(screen.getByRole("button", { name })).toBeVisible();
        expect(screen.getByRole("button", { name })).toBeEnabled();
      }
      expect(
        screen.getByRole("button", { name: "Cancel recording" }),
      ).toHaveTextContent("Cancel");
      expect(
        screen.getByRole("button", { name: "Send voice message" }),
      ).toHaveTextContent("Send");
      expect(
        screen.queryByText(/Model credits|NVIDIA|CC BY 4\.0/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(browserWhisperMock.transcribe).not.toHaveBeenCalled();
    },
  );

  it("transcribes manually and sends the transcript", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track, {
      config: { client_transcription_enabled: true },
    });
    browserWhisperMock.transcribe.mockImplementation((_file: File, options) => {
      options.onSegment({ text: "hello" });
      options.onSegment({ text: " world" });
      return {
        cancel: browserWhisperMock.cancel,
        collect: vi.fn(async () => []),
      };
    });

    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);

    await recordAndReview();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Transcribe voice message locally",
      }),
    );

    expect(
      await screen.findByRole("textbox", { name: "Voice message transcript" }),
    ).toHaveValue("hello world");
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));

    await waitFor(() => expect(getUploadFetchCalls()).toHaveLength(1));
    const [, init] = getUploadFetchCalls()[0];
    expect((init?.body as FormData | undefined)?.get("transcript")).toBe(
      "hello world",
    );
  });

  it("shows transcription errors and still sends audio", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track, {
      config: { client_transcription_enabled: true },
    });
    browserWhisperMock.transcribe.mockImplementation(() => {
      throw new Error("transcription failed");
    });

    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);

    await recordAndReview();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Transcribe voice message locally",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "transcription failed",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));

    await waitFor(() => expect(getUploadFetchCalls()).toHaveLength(1));
    const [, init] = getUploadFetchCalls()[0];
    expect((init?.body as FormData | undefined)?.get("audio")).toBeInstanceOf(
      File,
    );
  });

  it.each([{ segments: [] }, { segments: [{ text: " \n\t " }] }])(
    "shows an explicit empty result and preserves audio sending for $segments",
    async ({ segments }) => {
      // Given a recording whose transcription completes without words.
      installRecorderEnvironment(
        { stop: vi.fn() },
        {
          config: { client_transcription_enabled: true },
        },
      );
      browserWhisperMock.transcribe.mockReturnValue({
        cancel: browserWhisperMock.cancel,
        collect: vi.fn(async () => segments),
      });
      render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
      await recordAndReview();

      // When transcription completes and the original audio is sent.
      fireEvent.click(
        screen.getByRole("button", {
          name: "Transcribe voice message locally",
        }),
      );
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "No speech recognized",
        ),
      );
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "Transcribe voice message locally",
        }),
      ).toBeEnabled();
      fireEvent.click(
        screen.getByRole("button", { name: "Send voice message" }),
      );

      // Then sending remains available without fabricating a transcript.
      await waitFor(() => expect(getUploadFetchCalls()).toHaveLength(1));
      const form = getUploadFetchCalls()[0][1]?.body;
      expect(form).toBeInstanceOf(FormData);
      if (!(form instanceof FormData))
        throw new Error("Expected voice upload form");
      expect(form.get("audio")).toBeInstanceOf(File);
      expect(form.get("transcript")).toBeNull();
    },
  );

  it("retries an empty transcription on the same recording", async () => {
    // Given a completed empty transcription.
    installRecorderEnvironment(
      { stop: vi.fn() },
      {
        config: { client_transcription_enabled: true },
      },
    );
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    await recordAndReview();
    fireEvent.click(
      screen.getByRole("button", { name: "Transcribe voice message locally" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "No speech recognized",
      ),
    );
    browserWhisperMock.transcribe.mockReturnValueOnce({
      cancel: browserWhisperMock.cancel,
      collect: vi.fn(async () => [{ text: "recognized on retry" }]),
    });

    // When the user retries without recording again.
    fireEvent.click(
      screen.getByRole("button", { name: "Transcribe voice message locally" }),
    );

    // Then the successful result replaces the empty outcome.
    expect(
      await screen.findByRole("textbox", { name: "Voice message transcript" }),
    ).toHaveValue("recognized on retry");
    expect(screen.queryByText(/No speech recognized/)).not.toBeInTheDocument();
    expect(browserWhisperMock.transcribe).toHaveBeenCalledTimes(2);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it("reports phases without resetting percentages and cancels pending transcription", async () => {
    // Given a transcription that stays pending while stage events arrive.
    installRecorderEnvironment(
      { stop: vi.fn() },
      {
        config: { client_transcription_enabled: true },
      },
    );
    const completion = Promise.withResolvers<{ text: string }[]>();
    browserWhisperMock.transcribe.mockReturnValue({
      cancel: browserWhisperMock.cancel,
      collect: () => completion.promise,
    });
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    await recordAndReview();
    fireEvent.click(
      screen.getByRole("button", { name: "Transcribe voice message locally" }),
    );
    await waitFor(() =>
      expect(browserWhisperMock.transcribe).toHaveBeenCalledTimes(1),
    );
    const options = browserWhisperMock.transcribe.mock.calls[0][1];

    // When per-stage progress resets, the same status row names each phase.
    for (const [stage, progress, label] of [
      ["loading", 0.99, "Preparing model"],
      ["decoding", 0, "Preparing audio"],
      ["transcribing", 0, "Transcribing"],
      ["done", 1, "Transcribing"],
    ]) {
      act(() => options.onProgress({ stage, progress }));
      expect(screen.getByRole("status")).toHaveTextContent(String(label));
      expect(screen.getByRole("status")).not.toHaveTextContent(/\d+%/);
      expect(
        screen.getByRole("button", { name: "Cancel transcription" }),
      ).toBeEnabled();
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel transcription" }),
    );
    await act(async () => completion.resolve([]));

    // Then cancellation preserves review and ignores the late empty completion.
    expect(browserWhisperMock.cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Transcribe voice message locally" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Send voice message" }),
    ).toBeEnabled();
  });

  it("waits for transcription completion before editing or sending text", async () => {
    // Given a stream that has emitted a segment but has not completed.
    installRecorderEnvironment(
      { stop: vi.fn() },
      {
        config: { client_transcription_enabled: true },
      },
    );
    const completion = Promise.withResolvers<{ text: string }[]>();
    browserWhisperMock.transcribe.mockImplementation((_file: File, options) => {
      options.onSegment({ text: "first segment" });
      return {
        cancel: browserWhisperMock.cancel,
        collect: () => completion.promise,
      };
    });
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    await recordAndReview();
    fireEvent.click(
      screen.getByRole("button", { name: "Transcribe voice message locally" }),
    );
    await waitFor(() =>
      expect(browserWhisperMock.transcribe).toHaveBeenCalledTimes(1),
    );
    expect(
      screen.queryByRole("textbox", { name: "Voice message transcript" }),
    ).not.toBeInTheDocument();
    const sendButton = screen.getByRole("button", {
      name: "Send voice message",
    });
    expect(sendButton).toBeDisabled();
    fireEvent.click(sendButton);
    expect(getUploadFetchCalls()).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Cancel transcription" }),
    ).toBeEnabled();

    // When the stream finishes, replace the busy row with editable text once.
    await act(async () => completion.resolve([]));

    // Then the final transcript can be edited and sent.
    const transcript = screen.getByRole("textbox", {
      name: "Voice message transcript",
    });
    expect(transcript).toHaveValue("first segment");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(sendButton).toBeEnabled();
    fireEvent.change(transcript, { target: { value: "edited transcript" } });
    expect(transcript).toHaveValue("edited transcript");
  });

  it("auto-starts transcription after recording review is created", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track, {
      config: {
        client_transcription_enabled: true,
        client_transcription_auto_start: true,
      },
    });
    browserWhisperMock.transcribe.mockImplementation((_file: File, options) => {
      options.onSegment({ text: "auto text" });
      return {
        cancel: browserWhisperMock.cancel,
        collect: vi.fn(async () => []),
      };
    });

    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);

    await recordAndReview();

    expect(
      await screen.findByRole("textbox", { name: "Voice message transcript" }),
    ).toHaveValue("auto text");
    expect(browserWhisperMock.transcribe).toHaveBeenCalledTimes(1);
  });
  it("releases a microphone permission granted after unmount", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);
    const permission = Promise.withResolvers<MediaStream>();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(
      permission.promise,
    );
    const { unmount } = render(
      <VoiceRecorderAction draft={{ channelId: "channel-id" }} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    await waitFor(() =>
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1),
    );
    unmount();
    await act(async () =>
      permission.resolve({
        getTracks: () => [track],
      } as unknown as MediaStream),
    );
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("does not restore a cancelled review after waveform decoding finishes", async () => {
    installRecorderEnvironment({ stop: vi.fn() });
    const decoding = Promise.withResolvers<number[]>();
    vi.mocked(extractWaveformPeaksFromBlob).mockReturnValueOnce(
      decoding.promise,
    );
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    await screen.findByRole("button", { name: "Stop recording" });
    Date.now = vi.fn(() => 3_000);
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
    await act(async () => decoding.resolve([0.5]));
    expect(
      screen.getByRole("button", { name: "Record voice message" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Send voice message" }),
    ).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("detaches a delayed stop callback when recording is cancelled", async () => {
    installRecorderEnvironment({ stop: vi.fn() });
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    await screen.findByRole("button", { name: "Stop recording" });
    const recorder = FakeMediaRecorder.instances[0];
    recorder.stopDelayMs = 100;
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
    await act(
      async () => new Promise((resolve) => window.setTimeout(resolve, 120)),
    );
    expect(recorder.onstop).toBeNull();
    expect(recorder.ondataavailable).toBeNull();
    expect(
      screen.getByRole("button", { name: "Record voice message" }),
    ).toBeEnabled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it.each([
    { channelId: "second-channel", rootId: "first-root" },
    { channelId: "first-channel", rootId: "second-root" },
  ])(
    "starts a new recording session when the draft changes to %o",
    async (nextDraft) => {
      installRecorderEnvironment({ stop: vi.fn() });
      const { rerender } = render(
        <VoiceRecorderAction
          draft={{ channelId: "first-channel", rootId: "first-root" }}
        />,
      );
      await recordAndReview();
      rerender(<VoiceRecorderAction draft={nextDraft} />);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:voice-message");
      expect(
        screen.queryByRole("button", { name: "Send voice message" }),
      ).not.toBeInTheDocument();
      await screen.findByRole("button", { name: "Record voice message" });
      Date.now = vi.fn(() => 1_000);
      await recordAndReview();
      fireEvent.click(
        screen.getByRole("button", { name: "Send voice message" }),
      );
      await waitFor(() => expect(getUploadFetchCalls()).toHaveLength(1));
      const form = getUploadFetchCalls()[0][1]?.body as FormData;
      expect(form.get("channel_id")).toBe(nextDraft.channelId);
      expect(form.get("root_id")).toBe(nextDraft.rootId);
    },
  );

  it("stops the microphone and reports recorder start errors", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);
    vi.spyOn(FakeMediaRecorder.prototype, "start").mockImplementationOnce(
      () => {
        throw new Error("recorder start failed");
      },
    );
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "recorder start failed",
    );
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances[0].onstop).toBeNull();
  });

  it("aborts an upload when its recording session is unmounted", async () => {
    const pendingUpload = Promise.withResolvers<Response>();
    installRecorderEnvironment(
      { stop: vi.fn() },
      { uploadResponse: () => pendingUpload.promise },
    );
    const { unmount } = render(
      <VoiceRecorderAction draft={{ channelId: "channel-id" }} />,
    );
    await recordAndReview();
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
    await waitFor(() => expect(getUploadFetchCalls()).toHaveLength(1));
    const signal = getUploadFetchCalls()[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pendingUpload.resolve(defaultUploadResponse()));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:voice-message");
  });
  it("refreshes limits before microphone access and blocks failed configuration", async () => {
    installRecorderEnvironment({ stop: vi.fn() });
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    const record = await screen.findByRole("button", {
      name: "Record voice message",
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Settings unavailable", { status: 503 }),
    );
    fireEvent.click(record);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Settings unavailable",
    );
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("ignores a configuration response after cancellation", async () => {
    installRecorderEnvironment({ stop: vi.fn() });
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    const record = await screen.findByRole("button", {
      name: "Record voice message",
    });
    const response = Promise.withResolvers<Response>();
    vi.mocked(fetch).mockReturnValueOnce(response.promise);
    fireEvent.click(record);
    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
    await act(async () =>
      response.resolve(Response.json(defaultServerClientConfig)),
    );
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Record voice message" }),
    ).toBeEnabled();
  });

  it("uses a changed duration cap without remounting and stops at its deadline despite delayed flush", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    const record = await screen.findByRole("button", {
      name: "Record voice message",
    });
    installFetchMock({ config: { max_recording_duration_ms: 3000 } });
    fireEvent.click(record);
    await screen.findByRole("button", { name: "Stop recording" });
    const recorder = FakeMediaRecorder.instances[0];
    expect(recorder.timeslice).toBe(250);
    recorder.stopDelayMs = 1000;
    vi.useFakeTimers();
    // Restart the recording with fake timers so its own interval is controlled.
    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Record voice message" }),
      ),
    );
    const activeRecorder = FakeMediaRecorder.instances[1];
    activeRecorder.stopDelayMs = 1000;
    Date.now = vi.fn(() => 4100);
    await act(async () => vi.advanceTimersByTime(250));
    expect(activeRecorder.state).toBe("inactive");
    expect(track.stop).toHaveBeenCalledTimes(2);
    Date.now = vi.fn(() => 9000);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(
      screen.getByRole("button", { name: "Send voice message" }),
    ).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("duration limit");
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Send voice message" }),
      ),
    );
    const form = getUploadFetchCalls()[0][1]?.body;
    expect(form).toBeInstanceOf(FormData);
    if (!(form instanceof FormData)) throw new Error("Expected form data");
    expect(form.get("duration_ms")).toBe("3000");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([50, 51, 600])(
    "retains every chunk when final flush is %s bytes near a 1000 byte cap",
    async (flushBytes) => {
      installRecorderEnvironment(
        { stop: vi.fn() },
        {
          config: {
            max_voice_message_bytes: 1000,
            client_transcription_enabled: true,
            client_transcription_auto_start: true,
          },
        },
      );
      vi.mocked(extractWaveformPeaksFromBlob).mockClear();
      render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Record voice message" }),
      );
      await screen.findByRole("button", { name: "Stop recording" });
      const recorder = FakeMediaRecorder.instances[0];
      recorder.finalChunk = "x".repeat(flushBytes);
      Date.now = vi.fn(() => 3000);
      await act(async () => recorder.emitChunk(800));
      expect(recorder.state).toBe("recording");
      expect(screen.getByRole("status")).toHaveTextContent("Approaching limit");
      await act(async () => recorder.emitChunk(150));
      expect(recorder.state).toBe("inactive");
      const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0];
      expect(blob).toBeInstanceOf(Blob);
      if (!(blob instanceof Blob)) throw new Error("Expected audio blob");
      expect(blob.size).toBe(950 + flushBytes);
      if (flushBytes > 50) {
        expect(extractWaveformPeaksFromBlob).not.toHaveBeenCalled();
        expect(browserWhisperMock.transcribe).not.toHaveBeenCalled();
        expect(
          screen.getByRole("button", { name: "Send voice message" }),
        ).toBeDisabled();
        expect(
          screen.queryByRole("button", {
            name: "Transcribe voice message locally",
          }),
        ).not.toBeInTheDocument();
        expect(
          screen.getByRole("link", { name: "Download recording" }),
        ).toHaveAttribute("href", "blob:voice-message");
        expect(
          screen.getByRole("button", { name: "Play voice message" }),
        ).toBeEnabled();
        expect(getUploadFetchCalls()).toHaveLength(0);
      } else {
        expect(extractWaveformPeaksFromBlob).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      }
    },
  );

  it("keeps unlimited recordings active past the previous six hour cap", async () => {
    installRecorderEnvironment(
      { stop: vi.fn() },
      { config: { max_recording_duration_ms: 0 } },
    );
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    const record = await screen.findByRole("button", {
      name: "Record voice message",
    });
    vi.useFakeTimers();
    await act(async () => fireEvent.click(record));
    Date.now = vi.fn(() => 7 * 3600000);
    await act(async () => vi.advanceTimersByTime(250));
    expect(FakeMediaRecorder.instances[0].state).toBe("recording");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Stop recording" })),
    );
    expect(
      screen.getByRole("button", { name: "Send voice message" }),
    ).toBeEnabled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("blocks upload and preserves review when an administrator lowers limits after recording", async () => {
    installRecorderEnvironment({ stop: vi.fn() });
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    await recordAndReview();
    installFetchMock({ config: { max_voice_message_bytes: 1 } });
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("size limit");
    expect(getUploadFetchCalls()).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Send voice message" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Download recording" }),
    ).toHaveAttribute("href", "blob:voice-message");
  });

  it("blocks transcription when an administrator lowers limits after recording", async () => {
    installRecorderEnvironment(
      { stop: vi.fn() },
      { config: { client_transcription_enabled: true } },
    );
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    await recordAndReview();
    installFetchMock({
      config: {
        max_recording_duration_ms: 1000,
        client_transcription_enabled: true,
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Transcribe voice message locally" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "duration limit",
    );
    expect(browserWhisperMock.transcribe).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Send voice message" }),
    ).toBeDisabled();
  });
  it.each([499, 500])(
    "preserves the 500ms minimum at %sms",
    async (durationMs) => {
      installRecorderEnvironment({ stop: vi.fn() });
      render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Record voice message" }),
      );
      await screen.findByRole("button", { name: "Stop recording" });
      Date.now = vi.fn(() => 1000 + durationMs);
      fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
      const send = await screen.findByRole("button", {
        name: "Send voice message",
      });
      if (durationMs < 500) expect(send).toBeDisabled();
      else expect(send).toBeEnabled();
    },
  );

  it("preserves a single delayed chunk larger than the cap without decoding it", async () => {
    installRecorderEnvironment(
      { stop: vi.fn() },
      { config: { max_voice_message_bytes: 1000 } },
    );
    vi.mocked(extractWaveformPeaksFromBlob).mockClear();
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    await screen.findByRole("button", { name: "Stop recording" });
    Date.now = vi.fn(() => 3000);
    await act(async () => FakeMediaRecorder.instances[0].emitChunk(1500));
    expect(
      screen.getByRole("button", { name: "Send voice message" }),
    ).toBeDisabled();
    expect(extractWaveformPeaksFromBlob).not.toHaveBeenCalled();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0];
    if (!(blob instanceof Blob)) throw new Error("Expected audio blob");
    expect(blob.size).toBe(1510);
  });

  it("prioritizes the duration deadline when a delayed chunk arrives before its timer", async () => {
    installRecorderEnvironment(
      { stop: vi.fn() },
      {
        config: {
          max_voice_message_bytes: 1000,
          max_recording_duration_ms: 3000,
        },
      },
    );
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    await screen.findByRole("button", { name: "Stop recording" });
    Date.now = vi.fn(() => 4500);
    await act(async () => FakeMediaRecorder.instances[0].emitChunk(950));
    expect(screen.getByRole("status")).toHaveTextContent("duration limit");
    expect(
      screen.getByRole("button", { name: "Send voice message" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
    await waitFor(() => expect(getUploadFetchCalls()).toHaveLength(1));
    const form = getUploadFetchCalls()[0][1]?.body;
    if (!(form instanceof FormData)) throw new Error("Expected form data");
    expect(form.get("duration_ms")).toBe("3000");
  });

  it("clears the recording timer on cancellation and ignores a delayed flush", async () => {
    installRecorderEnvironment(
      { stop: vi.fn() },
      { config: { max_recording_duration_ms: 3000 } },
    );
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    const record = await screen.findByRole("button", {
      name: "Record voice message",
    });
    vi.useFakeTimers();
    await act(async () => fireEvent.click(record));
    const recorder = FakeMediaRecorder.instances[0];
    recorder.stopDelayMs = 1000;
    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
    Date.now = vi.fn(() => 999999);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(vi.getTimerCount()).toBe(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Record voice message" }),
    ).toBeEnabled();
  });
  it.each([true, false])(
    "refreshes the transcription controls between recordings when enabled becomes %s",
    async (enabled) => {
      installRecorderEnvironment(
        { stop: vi.fn() },
        { config: { client_transcription_enabled: !enabled } },
      );
      render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
      await recordAndReview();
      fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
      installFetchMock({ config: { client_transcription_enabled: enabled } });
      Date.now = vi.fn(() => 1000);
      await recordAndReview();
      const control = screen.queryByRole("button", {
        name: "Transcribe voice message locally",
      });
      if (enabled) expect(control).toBeEnabled();
      else expect(control).not.toBeInTheDocument();
    },
  );

  it("allows a preserved oversized recording after the administrator raises its cap", async () => {
    installRecorderEnvironment(
      { stop: vi.fn() },
      { config: { max_voice_message_bytes: 1000 } },
    );
    vi.mocked(extractWaveformPeaksFromBlob).mockClear();
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    await screen.findByRole("button", { name: "Stop recording" });
    Date.now = vi.fn(() => 3000);
    await act(async () => FakeMediaRecorder.instances[0].emitChunk(1500));
    expect(extractWaveformPeaksFromBlob).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Send voice message" }),
    ).toBeDisabled();
    installFetchMock({ config: { max_voice_message_bytes: 2000 } });
    fireEvent.click(
      screen.getByRole("button", { name: "Check current limits" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send voice message" }),
      ).toBeEnabled(),
    );
    expect(extractWaveformPeaksFromBlob).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
    await waitFor(() => expect(getUploadFetchCalls()).toHaveLength(1));
    const form = getUploadFetchCalls()[0][1]?.body;
    if (!(form instanceof FormData)) throw new Error("Expected form data");
    const audio = form.get("audio");
    if (!(audio instanceof File)) throw new Error("Expected audio file");
    expect(audio.size).toBe(1510);
  });

  it("ignores a delayed limit recheck after cancelling the preserved review", async () => {
    installRecorderEnvironment(
      { stop: vi.fn() },
      { config: { max_voice_message_bytes: 1000 } },
    );
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    await screen.findByRole("button", { name: "Stop recording" });
    Date.now = vi.fn(() => 3000);
    await act(async () => FakeMediaRecorder.instances[0].emitChunk(1500));
    const response = Promise.withResolvers<Response>();
    vi.mocked(fetch).mockReturnValueOnce(response.promise);
    fireEvent.click(
      screen.getByRole("button", { name: "Check current limits" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
    await act(async () =>
      response.resolve(Response.json(defaultServerClientConfig)),
    );
    expect(
      screen.getByRole("button", { name: "Record voice message" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Send voice message" }),
    ).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:voice-message");
  });
  it("shows the configured six hour recording limit as hours", async () => {
    installRecorderEnvironment({ stop: vi.fn() });
    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    await screen.findByRole("button", { name: "Stop recording" });
    expect(screen.getByText("0:00 / 6:00:00")).toBeInTheDocument();
  });
});
