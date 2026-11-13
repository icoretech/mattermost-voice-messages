import {
  parseTranscriptionFrameResponse,
  transcriptionFrameHandshake,
} from "./frame_protocol";

const { transcribeInFrame } = vi.hoisted(() => ({
  transcribeInFrame: vi.fn(),
}));
vi.mock("./frame_transcription", () => ({ transcribeInFrame }));

function nextMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.addEventListener(
      "message",
      (event: MessageEvent<unknown>) => resolve(event.data),
      { once: true },
    );
    port.start();
  });
}
describe("transcription frame connection", () => {
  let parentFrame: HTMLIFrameElement;
  const channels: MessageChannel[] = [];
  function channel() {
    const value = new MessageChannel();
    channels.push(value);
    return value;
  }
  function parentWindow() {
    const parent = parentFrame.contentWindow;
    if (!parent) throw new Error("Parent fixture missing");
    return parent;
  }
  function connect(
    port: MessagePort,
    overrides: MessageEventInit<unknown> = {},
  ) {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: parentWindow(),
        origin: window.location.origin,
        data: transcriptionFrameHandshake,
        ports: [port],
        ...overrides,
      }),
    );
  }
  beforeEach(async () => {
    vi.resetModules();
    transcribeInFrame.mockReset();
    parentFrame = document.createElement("iframe");
    document.body.append(parentFrame);
    vi.spyOn(window, "parent", "get").mockReturnValue(parentWindow());
    await import("./transcription_frame_entry");
  });
  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    for (const value of channels.splice(0)) {
      value.port1.close();
      value.port2.close();
    }
    parentFrame.remove();
    vi.restoreAllMocks();
  });

  it.each(["origin", "source", "version"] as const)(
    "ignores a handshake with invalid %s before accepting the real parent",
    async (invalid) => {
      const rejected = channel();
      const accepted = channel();
      const response = nextMessage(accepted.port1);
      const override =
        invalid === "origin"
          ? { origin: "https://example.com" }
          : invalid === "source"
            ? { source: window }
            : { data: { ...transcriptionFrameHandshake, version: 2 } };

      connect(rejected.port2, override);
      connect(accepted.port2);

      expect(await response).toEqual({ type: "ready" });
      expect(transcribeInFrame).not.toHaveBeenCalled();
    },
  );

  it("reports cancellation before inference starts", async () => {
    const ports = channel();
    const ready = nextMessage(ports.port1);
    connect(ports.port2);
    await ready;
    const response = nextMessage(ports.port1);

    ports.port1.postMessage({ type: "cancel" });

    expect(parseTranscriptionFrameResponse(await response)).toMatchObject({
      type: "error",
      name: "AbortError",
    });
    expect(transcribeInFrame).not.toHaveBeenCalled();
  });

  it("rejects malformed audio messages before invoking inference", async () => {
    const ports = channel();
    const ready = nextMessage(ports.port1);
    connect(ports.port2);
    await ready;
    const response = nextMessage(ports.port1);

    ports.port1.postMessage({ type: "start", blob: "not audio" });

    expect(parseTranscriptionFrameResponse(await response)).toMatchObject({
      type: "error",
      name: "TypeError",
    });
    expect(transcribeInFrame).not.toHaveBeenCalled();
  });
});
