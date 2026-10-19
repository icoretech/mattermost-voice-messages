import { transcribeVoiceMessageBlob } from "./client_transcription";

const { transcribe, transcribePCM, dispose, cancel, decode, close } =
  vi.hoisted(() => ({
    transcribe: vi.fn(),
    transcribePCM: vi.fn(),
    dispose: vi.fn(),
    cancel: vi.fn(),
    decode: vi.fn(),
    close: vi.fn(),
  }));
vi.mock("browser-whisper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("browser-whisper")>()),
  BrowserWhisper: class {
    transcribe = transcribe;
    transcribePCM = transcribePCM;
    dispose = dispose;
  },
}));
const options = {
  model: "parakeet-tdt-0.6b-v3",
  quantization: "q8",
  language: "",
} as const;
const run = (overrides = {}) =>
  transcribeVoiceMessageBlob(new Blob(["audio"]), "audio/webm", {
    ...options,
    ...overrides,
  });
function audio(channels: Float32Array[]) {
  return {
    length: channels[0].length,
    numberOfChannels: channels.length,
    getChannelData: (index: number) => channels[index],
  };
}

describe("Parakeet PCM recordings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    close.mockResolvedValue(undefined);
    transcribe.mockReturnValue({ collect: async () => [], cancel });
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor(options: AudioContextOptions) {
          expect(options.sampleRate).toBe(16000);
        }
        decodeAudioData = decode;
        close = close;
      },
    );
    vi.spyOn(Blob.prototype, "arrayBuffer").mockResolvedValue(
      new ArrayBuffer(4),
    );
    transcribePCM.mockImplementation(() => ({
      collect: async () => [{ text: "test" }],
      cancel,
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps short recordings unpadded and downmixes stereo", async () => {
    // Given a short stereo recording decoded at 16 kHz.
    decode.mockResolvedValue(
      audio([new Float32Array([1, 0.5, 0]), new Float32Array([0, -0.5, 1])]),
    );
    // When it is transcribed.
    await expect(run()).resolves.toBe("test");
    // Then the engine receives only the actual mono samples.
    expect(transcribePCM.mock.calls[0][0]).toEqual(
      new Float32Array([0.5, 0, 0.5]),
    );
    expect(transcribe).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("aggregates sequential windows including an unpadded final tail", async () => {
    // Given audio longer than a single 30-second window.
    const samples = new Float32Array(480003);
    samples[480002] = 0.75;
    decode.mockResolvedValue(audio([samples]));
    const onText = vi.fn();
    const onProgress = vi.fn();
    let resolveFirst: (value: { text: string }[]) => void = () => undefined;
    const first = new Promise<{ text: string }[]>((resolve) => {
      resolveFirst = resolve;
    });
    transcribePCM
      .mockImplementationOnce((_samples, callbacks) => {
        callbacks.onSegment({ text: "first" });
        callbacks.onProgress({ stage: "done", progress: 1 });
        return { collect: () => first, cancel };
      })
      .mockImplementationOnce(() => ({
        collect: async () => [{ text: "tail" }],
        cancel,
      }));
    // When the first window is still running, the tail must wait.
    const promise = run({ onText, onProgress });
    await vi.waitFor(() => expect(transcribePCM).toHaveBeenCalledOnce());
    expect(onProgress).not.toHaveBeenCalledWith({ stage: "done", progress: 1 });
    resolveFirst([]);
    await expect(promise).resolves.toBe("first tail");
    // Then both texts and only the original tail samples reach the caller/engine.
    expect(transcribePCM.mock.calls.map(([pcm]) => pcm.length)).toEqual([
      480000, 3,
    ]);
    expect(transcribePCM.mock.calls[1][0][2]).toBe(0.75);
    expect(onText).toHaveBeenLastCalledWith("first tail");
    expect(onProgress).toHaveBeenLastCalledWith({ stage: "done", progress: 1 });
  });

  it("closes the decoder and never starts inference after cancellation during decoding", async () => {
    // Given a pending browser decode.
    let resolveDecode: (value: ReturnType<typeof audio>) => void = () =>
      undefined;
    decode.mockReturnValue(
      new Promise((resolve) => {
        resolveDecode = resolve;
      }),
    );
    const controller = new AbortController();
    const promise = run({ signal: controller.signal });
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    // When cancelled, including a late native decode completion.
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    resolveDecode(audio([new Float32Array([0.5])]));
    await Promise.resolve();
    // Then no stale inference begins and resources are released.
    expect(transcribePCM).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("cancels collection and suppresses stale segment callbacks", async () => {
    // Given a pending PCM inference.
    decode.mockResolvedValue(audio([new Float32Array(480001)]));
    transcribePCM.mockReturnValue({
      collect: () => new Promise(() => undefined),
      cancel,
    });
    const controller = new AbortController();
    const onText = vi.fn();
    const promise = run({ signal: controller.signal, onText });
    await vi.waitFor(() => expect(transcribePCM).toHaveBeenCalledOnce());
    // When cancellation is followed by a stale worker callback.
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    transcribePCM.mock.calls[0][1].onSegment({ text: "late" });
    // Then no tail or stale text is published.
    expect(transcribePCM).toHaveBeenCalledOnce();
    expect(onText).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("releases resources and propagates native decode failures", async () => {
    // Given a browser decoder rejecting an invalid recording.
    decode.mockRejectedValue(
      new DOMException("Invalid audio", "EncodingError"),
    );
    // When transcription starts, decoding fails before inference.
    await expect(run()).rejects.toMatchObject({ name: "EncodingError" });
    // Then both owned resources are released without starting inference.
    expect(transcribePCM).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
