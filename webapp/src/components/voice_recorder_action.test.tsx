import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { waveformBarCount } from "../audio/waveform";
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

vi.mock("browser-whisper", () => ({
  BrowserWhisper: vi.fn(function BrowserWhisperMock(this: {
    dispose: typeof browserWhisperMock.dispose;
    transcribe: typeof browserWhisperMock.transcribe;
  }) {
    this.dispose = browserWhisperMock.dispose;
    this.transcribe = browserWhisperMock.transcribe;
  }),
  MODELS: {
    "whisper-tiny": {},
    "whisper-base": {},
  },
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

  public constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeMediaRecorder.instances.push(this);
  }

  public start() {
    this.state = "recording";
  }

  public stop() {
    this.state = "inactive";
    const emitStop = () => {
      this.ondataavailable?.({
        data: new Blob(["voice-data"], { type: this.mimeType }),
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
  voice_messages_enabled: boolean;
  uploaded_audio_preview_enabled: boolean;
  client_transcription_enabled: boolean;
  client_transcription_auto_start: boolean;
  client_transcription_model: string;
  client_transcription_quantization: string;
  client_transcription_language: string;
};

const defaultServerClientConfig: ServerClientConfig = {
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
      name: "Requesting microphone permission",
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

  it("keeps the mic icon on the retry control after upload errors", async () => {
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
    const retryButton = screen.getByRole("button", {
      name: "Record voice message",
    });
    expect(retryButton.querySelector("svg")).toBeInTheDocument();
  });

  it("stops tracks when recording is cancelled", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);

    render(<VoiceRecorderAction draft={{ channelId: "channel-id" }} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Record voice message" }),
    );
    expect(
      await screen.findByRole("button", { name: "Cancel recording" }),
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
    expect((init?.body as FormData).get("transcript")).toBeNull();
  });

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
    expect((init?.body as FormData).get("transcript")).toBe("hello world");
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
    expect((init?.body as FormData).get("audio")).toBeInstanceOf(File);
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
});
