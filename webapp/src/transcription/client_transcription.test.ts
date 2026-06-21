import { transcribeVoiceMessageBlob } from "./client_transcription";

const cancel = vi.fn();
const dispose = vi.fn();
const transcribe = vi.fn();

vi.mock("browser-whisper", () => ({
  BrowserWhisper: vi.fn(function BrowserWhisperMock(this: {
    transcribe: typeof transcribe;
    dispose: typeof dispose;
  }) {
    this.transcribe = transcribe;
    this.dispose = dispose;
  }),
}));

describe("client transcription", () => {
  beforeEach(() => {
    cancel.mockReset();
    dispose.mockReset();
    transcribe.mockReset();
    Object.defineProperty(globalThis, "crossOriginIsolated", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects without cross-origin isolation", async () => {
    Object.defineProperty(globalThis, "crossOriginIsolated", {
      configurable: true,
      value: false,
    });

    await expect(
      transcribeVoiceMessageBlob(new Blob(["audio"]), "audio/webm", {
        model: "whisper-tiny",
        quantization: "hybrid",
        language: "",
      }),
    ).rejects.toThrow(
      "Local transcription requires Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp on the Mattermost site",
    );
  });

  it("returns normalized text from segments", async () => {
    transcribe.mockImplementation((_file: File, options) => {
      options.onSegment({ text: "hello" });
      options.onSegment({ text: " world" });
      return {
        collect: vi.fn(async () => []),
        cancel,
      };
    });
    const onText = vi.fn();

    await expect(
      transcribeVoiceMessageBlob(new Blob(["audio"]), "audio/webm", {
        model: "whisper-tiny",
        quantization: "hybrid",
        language: "",
        onText,
      }),
    ).resolves.toBe("hello world");
    expect(onText).toHaveBeenLastCalledWith("hello world");
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("cancels stream and disposes on abort", async () => {
    const abortController = new AbortController();
    transcribe.mockReturnValue({
      collect: vi.fn(
        () => new Promise((resolve) => window.setTimeout(resolve, 1000)),
      ),
      cancel,
    });

    const promise = transcribeVoiceMessageBlob(
      new Blob(["audio"]),
      "audio/webm",
      {
        model: "whisper-tiny",
        quantization: "hybrid",
        language: "",
        signal: abortController.signal,
      },
    );
    abortController.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
