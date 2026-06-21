import manifest, {
  clientTranscriptionModels,
  clientTranscriptionQuantizations,
} from "./manifest";

type ManifestSetting = {
  key?: unknown;
  options?: Array<{ value?: unknown }>;
};

function settingOptionValues(key: string): string[] {
  const settings = (
    manifest as {
      settings_schema?: { settings?: ManifestSetting[] };
    }
  ).settings_schema?.settings;
  const setting = settings?.find((candidate) => candidate.key === key);
  return (
    setting?.options
      ?.map((option) => option.value)
      .filter((value): value is string => typeof value === "string") ?? []
  );
}

describe("generated manifest transcription domains", () => {
  it("exports model and quantization tuples from the manifest settings schema", () => {
    expect(clientTranscriptionModels).toEqual(
      settingOptionValues("ClientTranscriptionModel"),
    );
    expect(clientTranscriptionQuantizations).toEqual(
      settingOptionValues("ClientTranscriptionQuantization"),
    );
  });
});
