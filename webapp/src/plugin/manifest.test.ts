import { MODELS } from "browser-whisper";
import manifest, {
  clientTranscriptionModels,
  clientTranscriptionQuantizations,
} from "./manifest";

type ManifestSetting = {
  key?: unknown;
  help_text?: string;
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

  it("keeps Parakeet attribution in the generated model setting help", () => {
    // Given the generated settings consumed by the plugin configuration UI.
    const settings: ManifestSetting[] = manifest.settings_schema.settings;

    // When reading the selectable transcription model's help.
    const helpText = settings.find(
      (setting) => setting.key === "ClientTranscriptionModel",
    )?.help_text;

    // Then author, license, and conversion credits remain available there.
    for (const credit of [
      "[NVIDIA](https://huggingface.co/nvidia)",
      "[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)",
      "istupakov",
      "ysdede",
      "onnx-community",
    ]) {
      expect(helpText).toContain(credit);
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
