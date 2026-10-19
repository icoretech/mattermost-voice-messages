import { BrowserWhisper } from "browser-whisper";
import { clientTranscriptionModels } from "../plugin/manifest";
import { transcribeVoiceMessageBlob } from "./client_transcription";

const cancel = vi.fn();
const dispose = vi.fn();
const transcribe = vi.fn();
const transcribePCM = vi.fn();

vi.mock("browser-whisper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("browser-whisper")>()),
  BrowserWhisper: vi.fn(function BrowserWhisperMock(this: {
    transcribe: typeof transcribe;
    transcribePCM: typeof transcribePCM;
    dispose: typeof dispose;
  }) {
    this.transcribe = transcribe;
    this.transcribePCM = transcribePCM;
    this.dispose = dispose;
  }),
}));

describe("client transcription", () => {
  beforeEach(() => {
    vi.mocked(BrowserWhisper).mockClear();
    cancel.mockReset();
    dispose.mockReset();
    transcribe.mockReset();
    transcribePCM
      .mockReset()
      .mockReturnValue({ collect: async () => [], cancel });
    vi.stubGlobal(
      "AudioContext",
      class {
        decodeAudioData = async () => ({
          length: 1,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([0.5]),
        });
        close = async () => undefined;
      },
    );
    vi.spyOn(Blob.prototype, "arrayBuffer").mockResolvedValue(
      new ArrayBuffer(0),
    );
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

  it.each(clientTranscriptionModels)(
    "passes configured language only to a language-selectable model: %s",
    async (model) => {
      // Given an explicitly configured language and the real module metadata.
      transcribe.mockReturnValue({ collect: async () => [], cancel });

      // When a recording is transcribed using each offered model.
      await transcribeVoiceMessageBlob(new Blob(["audio"]), "audio/webm", {
        model,
        quantization: "hybrid",
        language: "it",
      });

      // Then only multilingual Whisper models receive the language option.
      const expectedOptions = {
        model,
        quantization: "hybrid",
        ...(model.startsWith("whisper-") || model.startsWith("lite-whisper-")
          ? { language: "it" }
          : {}),
      };
      expect(BrowserWhisper).toHaveBeenCalledExactlyOnceWith(expectedOptions);
      expect(dispose).toHaveBeenCalledExactlyOnceWith();
    },
  );

  it("omits the language option when automatic detection is configured", async () => {
    // Given no explicit language.
    transcribe.mockReturnValue({ collect: async () => [], cancel });

    // When a language-selectable Whisper model transcribes the recording.
    await transcribeVoiceMessageBlob(new Blob(["audio"]), "audio/webm", {
      model: "whisper-tiny",
      quantization: "hybrid",
      language: "",
    });

    // Then the library uses its automatic detection default.
    expect(BrowserWhisper).toHaveBeenCalledExactlyOnceWith({
      model: "whisper-tiny",
      quantization: "hybrid",
    });
  });

  it("disposes the model when inference rejects", async () => {
    // Given an inference failure after model creation.
    transcribe.mockReturnValue({
      collect: async () => {
        throw new Error("inference failed");
      },
      cancel,
    });

    // When collection fails, the original error reaches the caller.
    await expect(
      transcribeVoiceMessageBlob(new Blob(["audio"]), "audio/webm", {
        model: "whisper-tiny",
        quantization: "hybrid",
        language: "",
      }),
    ).rejects.toThrow("inference failed");

    // Then the model is still disposed.
    expect(dispose).toHaveBeenCalledExactlyOnceWith();
  });

  it("cancels stream and disposes on abort", async () => {
    const abortController = new AbortController();
    transcribe.mockReturnValue({
      collect: vi.fn(() => new Promise(() => undefined)),
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
