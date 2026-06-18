import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { VoiceRecorderAction } from "./components/voice_recorder_action";
import { waveformBarCount } from "./waveform";

vi.mock("./waveform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./waveform")>();
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

function installRecorderEnvironment(track: FakeTrack) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
      })),
    },
  });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            post: { id: "post-id" },
            file_info: { id: "file-id" },
          }),
          { status: 201 },
        ),
    ),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice-message");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
}

describe("VoiceRecorderAction", () => {
  const originalMediaDevices = navigator.mediaDevices;
  const realDateNow = Date.now;
  const originalPause = HTMLMediaElement.prototype.pause;

  beforeEach(() => {
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
        getSelectedText={() => ({})}
        updateText={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Record voice message" }),
    );
    expect(
      await screen.findByRole("button", { name: "Stop recording" }),
    ).toBeInTheDocument();

    Date.now = vi.fn(() => 3_000);
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(
      await screen.findByRole("button", { name: "Send voice message" }),
    ).toBeInTheDocument();
    expect(track.stop).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    const formData = init?.body as FormData;
    expect(formData.get("channel_id")).toBe("channel-id");
    expect(formData.get("root_id")).toBe("root-id");
    expect(formData.get("duration_ms")).toBe("2000");
    expect(formData.get("mime_type")).toBe("audio/webm;codecs=opus");
    expect(formData.get("audio")).toBeInstanceOf(File);
    expect(JSON.parse(String(formData.get("waveform")))).toHaveLength(
      waveformBarCount,
    );
  });

  it("captures stop time before delayed recorder stop callback", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);

    render(
      <VoiceRecorderAction
        draft={{ channelId: "channel-id", rootId: "root-id" }}
        getSelectedText={() => ({})}
        updateText={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Record voice message" }),
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

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const formData = init?.body as FormData;
    expect(formData.get("duration_ms")).toBe("4000");
  });

  it("keeps the mic icon on the retry control after upload errors", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Invalid duration_ms", { status: 400 }),
    );

    render(
      <VoiceRecorderAction
        draft={{ channelId: "channel-id" }}
        getSelectedText={() => ({})}
        updateText={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Record voice message" }),
    );
    await screen.findByRole("button", { name: "Stop recording" });
    Date.now = vi.fn(() => 3_000);
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    await screen.findByRole("button", { name: "Send voice message" });
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

    render(
      <VoiceRecorderAction
        draft={{ channelId: "channel-id" }}
        getSelectedText={() => ({})}
        updateText={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Record voice message" }),
    );
    expect(
      await screen.findByRole("button", { name: "Cancel recording" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops tracks when unmounted during recording", async () => {
    const track = { stop: vi.fn() };
    installRecorderEnvironment(track);

    const { unmount } = render(
      <VoiceRecorderAction
        draft={{ channelId: "channel-id" }}
        getSelectedText={() => ({})}
        updateText={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Record voice message" }),
    );
    expect(
      await screen.findByRole("button", { name: "Stop recording" }),
    ).toBeInTheDocument();
    unmount();

    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});
