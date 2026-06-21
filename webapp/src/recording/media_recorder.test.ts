import {
  isRecordingSupported,
  preferredAudioMimeTypes,
  selectAudioMimeType,
} from "./media_recorder";

describe("media recorder helpers", () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalMediaDevices = navigator.mediaDevices;

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
    if (originalMediaRecorder) {
      vi.stubGlobal("MediaRecorder", originalMediaRecorder);
    } else {
      vi.stubGlobal("MediaRecorder", undefined);
    }
  });

  it("selects WebM after checking and rejecting MP4 first", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: vi.fn(
        (mimeType: string) => mimeType === "audio/webm;codecs=opus",
      ),
    });

    expect(selectAudioMimeType()).toBe("audio/webm;codecs=opus");
    expect(MediaRecorder.isTypeSupported).toHaveBeenCalledWith("audio/mp4");
    expect(MediaRecorder.isTypeSupported).toHaveBeenCalledWith(
      "audio/webm;codecs=opus",
    );
    expect(MediaRecorder.isTypeSupported).not.toHaveBeenCalledWith(
      "audio/ogg;codecs=opus",
    );
  });

  it("selects MP4 without checking later candidates", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: vi.fn((mimeType: string) => mimeType === "audio/mp4"),
    });

    expect(selectAudioMimeType()).toBe("audio/mp4");
    expect(MediaRecorder.isTypeSupported).toHaveBeenCalledWith(
      preferredAudioMimeTypes[0],
    );
    expect(MediaRecorder.isTypeSupported).not.toHaveBeenCalledWith(
      preferredAudioMimeTypes[1],
    );
    expect(MediaRecorder.isTypeSupported).not.toHaveBeenCalledWith(
      preferredAudioMimeTypes[2],
    );
  });

  it("allows the browser default encoder when no preferred type is supported", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: vi.fn(() => false),
    });

    expect(selectAudioMimeType()).toBeUndefined();
  });

  it("requires getUserMedia and MediaRecorder support", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    vi.stubGlobal("MediaRecorder", { isTypeSupported: vi.fn() });
    expect(isRecordingSupported()).toBe(true);

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {},
    });
    expect(isRecordingSupported()).toBe(false);

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    vi.stubGlobal("MediaRecorder", undefined);
    expect(isRecordingSupported()).toBe(false);
  });
});
