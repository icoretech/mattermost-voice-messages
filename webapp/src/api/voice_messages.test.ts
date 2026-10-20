import uploadContract from "../../../testdata/voice_message_upload_contract.json";
import { uploadVoiceMessage } from "./voice_messages";

type VoiceMessageUploadContract = {
  audio_field: string;
  file_name: string;
  file_mime_type: string;
  text_fields: {
    channel_id: string;
    root_id: string;
    duration_ms: string;
    waveform: string;
    transcript: string;
  };
  forbidden_text_fields: string[];
};

function loadUploadContract(): VoiceMessageUploadContract {
  return uploadContract as VoiceMessageUploadContract;
}

function mockCreatedUpload() {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          post: { id: "post-id" },
          file_info: { id: "file-id" },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 201,
        },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("voice message upload contract", () => {
  it("emits the multipart field map accepted by the server", async () => {
    const contract = loadUploadContract();
    const fetchMock = mockCreatedUpload();
    const controller = new AbortController();

    try {
      await uploadVoiceMessage({
        blob: new Blob(["abc"], { type: contract.file_mime_type }),
        channelId: contract.text_fields.channel_id,
        rootId: contract.text_fields.root_id,
        durationMs: Number(contract.text_fields.duration_ms),
        mimeType: contract.file_mime_type,
        waveform: JSON.parse(contract.text_fields.waveform) as number[],
        transcript: `  ${contract.text_fields.transcript}  `,
        signal: controller.signal,
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [, init] = fetchMock.mock.calls[0];
      if (!init) {
        throw new Error("Missing fetch init");
      }
      expect(init.credentials).toBe("same-origin");
      expect(init.signal).toBe(controller.signal);
      expect(new Headers(init.headers).has("Content-Type")).toBe(false);
      const formData = init.body as FormData;
      const audio = formData.get(contract.audio_field);
      expect(audio).toBeInstanceOf(File);
      expect((audio as File).name).toBe(contract.file_name);
      expect((audio as File).type).toBe(contract.file_mime_type);
      expect(formData.get("channel_id")).toBe(contract.text_fields.channel_id);
      expect(formData.get("root_id")).toBe(contract.text_fields.root_id);
      expect(formData.get("duration_ms")).toBe(
        contract.text_fields.duration_ms,
      );
      expect(formData.get("waveform")).toBe(contract.text_fields.waveform);
      expect(formData.get("transcript")).toBe(contract.text_fields.transcript);
      for (const field of contract.forbidden_text_fields) {
        expect(formData.has(field)).toBe(false);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("voice message upload CSRF", () => {
  const cookieNames = ["MMCSRF", "MMCSRF_extra", "prefixMMCSRF"];

  function setCookie(name: string, value: string) {
    // biome-ignore lint/suspicious/noDocumentCookie: exercise the real browser cookie store in jsdom.
    document.cookie = `${name}=${value}; path=/`;
  }

  function upload() {
    return uploadVoiceMessage({
      blob: new Blob([new Uint8Array(480_000)], { type: "audio/wav" }),
      channelId: "channel-id",
      durationMs: 30_000,
      mimeType: "audio/wav",
    });
  }

  function sentHeaders(
    fetchMock: ReturnType<typeof mockCreatedUpload>,
    index = 0,
  ) {
    return new Headers(fetchMock.mock.calls[index]?.[1]?.headers);
  }

  afterEach(() => {
    for (const name of cookieNames) {
      // biome-ignore lint/suspicious/noDocumentCookie: remove only the cookies created by these tests.
      document.cookie = `${name}=; Max-Age=0; path=/`;
    }
    vi.unstubAllGlobals();
  });

  it.each(["session-csrf-token", "raw%2Btoken%3D"])(
    "sends the raw session cookie in the CSRF header for a large upload (%s)",
    async (token) => {
      setCookie("MMCSRF_extra", "other-token");
      setCookie("prefixMMCSRF", "other-token");
      setCookie("MMCSRF", token);
      const fetchMock = mockCreatedUpload();

      await upload();

      expect(sentHeaders(fetchMock).get("X-CSRF-Token")).toBe(token);
      expect(sentHeaders(fetchMock).get("X-Requested-With")).toBe(
        "XMLHttpRequest",
      );
      const formData = fetchMock.mock.calls[0]?.[1]?.body;
      if (!(formData instanceof FormData)) {
        throw new Error("Missing upload form data");
      }
      const audio = formData.get("audio");
      expect((audio as File).size).toBe(480_000);
    },
  );

  it.each(["absent", "empty", "similarly named"])(
    "omits the CSRF header when the session cookie is %s",
    async (cookieState) => {
      if (cookieState === "empty") {
        setCookie("MMCSRF", "");
      } else if (cookieState === "similarly named") {
        setCookie("MMCSRF_extra", "other-token");
        setCookie("prefixMMCSRF", "other-token");
      }
      const fetchMock = mockCreatedUpload();

      await upload();

      expect(sentHeaders(fetchMock).has("X-CSRF-Token")).toBe(false);
      expect(sentHeaders(fetchMock).get("X-Requested-With")).toBe(
        "XMLHttpRequest",
      );
    },
  );

  it("reads the current token on each upload after a session change", async () => {
    const fetchMock = mockCreatedUpload();
    setCookie("MMCSRF", "first-session-token");
    await upload();

    setCookie("MMCSRF", "new-session-token");
    await upload();

    expect(sentHeaders(fetchMock, 0).get("X-CSRF-Token")).toBe(
      "first-session-token",
    );
    expect(sentHeaders(fetchMock, 1).get("X-CSRF-Token")).toBe(
      "new-session-token",
    );
  });
});
