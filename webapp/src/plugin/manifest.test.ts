import { MODELS } from "browser-whisper";
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
  it("offers exactly the models exported by the installed browser-whisper module", () => {
    // Given the generated model choices and the unmocked public package export.
    const availableModels = Object.keys(MODELS).sort();

    // When the selectable model identifiers are read from the manifest.
    const offeredModels = [...clientTranscriptionModels].sort();

    // Then no removed model is offered and no supported model is missing.
    expect(offeredModels).toEqual(availableModels);
    for (const model of clientTranscriptionModels) {
      expect(typeof MODELS[model].capabilities.language).toBe("boolean");
    }
  });

  it("exports model and quantization tuples from the manifest settings schema", () => {
    expect(clientTranscriptionModels).toEqual(
      settingOptionValues("ClientTranscriptionModel"),
    );
    expect(clientTranscriptionQuantizations).toEqual(
      settingOptionValues("ClientTranscriptionQuantization"),
    );
  });
});
