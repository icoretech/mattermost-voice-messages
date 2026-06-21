import type { Post } from "@mattermost/types/posts";
import { VoiceFilePreviewOverride } from "../components/voice_file_preview_override";
import { VoicePostComponent } from "../components/voice_post";
import { createVoicePostAttachmentComponent } from "../components/voice_post_attachment";
import { VoiceRecorderAction } from "../components/voice_recorder_action";
import { legacyVoicePostType } from "../constants";
import manifest from "./manifest";
import { shouldOverrideVoiceFilePreview } from "./voice_file_preview";
import "../styles/voice_messages.scss";
import type { PluginRegistry } from "../types/mattermost-webapp";

type MattermostStore = {
  getState: () => {
    entities?: {
      posts?: {
        posts?: Record<string, Post | undefined>;
      };
    };
  };
};
class VoiceMessagesPlugin {
  public initialize(registry: PluginRegistry, store?: MattermostStore) {
    registry.registerPostEditorActionComponent(VoiceRecorderAction);
    // Keep rendering historical custom post types; new mobile-safe voice messages render through file attachments.
    registry.registerPostTypeComponent(legacyVoicePostType, VoicePostComponent);
    registry.registerFilePreviewComponent(
      shouldOverrideVoiceFilePreview,
      VoiceFilePreviewOverride,
    );
    const getPostById = (postId: string) =>
      store?.getState().entities?.posts?.posts?.[postId];
    registry.registerPostMessageAttachmentComponent(
      createVoicePostAttachmentComponent(getPostById),
    );
  }
}

declare global {
  interface Window {
    registerPlugin(pluginId: string, plugin: VoiceMessagesPlugin): void;
  }
}

window.registerPlugin(manifest.id, new VoiceMessagesPlugin());
