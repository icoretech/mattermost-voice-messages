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

describe("voice message upload contract", () => {
  it("emits the multipart field map accepted by the server", async () => {
    const contract = loadUploadContract();
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

    try {
      await uploadVoiceMessage({
        blob: new Blob(["abc"], { type: contract.file_mime_type }),
        channelId: contract.text_fields.channel_id,
        rootId: contract.text_fields.root_id,
        durationMs: Number(contract.text_fields.duration_ms),
        mimeType: contract.file_mime_type,
        waveform: JSON.parse(contract.text_fields.waveform) as number[],
        transcript: `  ${contract.text_fields.transcript}  `,
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [, init] = fetchMock.mock.calls[0];
      if (!init) {
        throw new Error("Missing fetch init");
      }
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
