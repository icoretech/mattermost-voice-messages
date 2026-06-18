import { VoiceFilePreviewOverride } from "./components/voice_file_preview_override";
import { VoicePostComponent } from "./components/voice_post";
import { VoiceRecorderAction } from "./components/voice_recorder_action";
import { voicePostType } from "./constants";
import manifest from "./manifest";
import { shouldOverrideVoiceFilePreview } from "./voice_file_preview";
import "./styles/voice_messages.scss";
import type { PluginRegistry } from "./types/mattermost-webapp";

class VoiceMessagesPlugin {
  public initialize(registry: PluginRegistry) {
    registry.registerPostEditorActionComponent(VoiceRecorderAction);
    registry.registerPostTypeComponent(voicePostType, VoicePostComponent);
    registry.registerFilePreviewComponent(
      shouldOverrideVoiceFilePreview,
      VoiceFilePreviewOverride,
    );
  }
}

declare global {
  interface Window {
    registerPlugin(pluginId: string, plugin: VoiceMessagesPlugin): void;
  }
}

window.registerPlugin(manifest.id, new VoiceMessagesPlugin());
