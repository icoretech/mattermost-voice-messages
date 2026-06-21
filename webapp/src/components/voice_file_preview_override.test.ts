import type { FileInfo } from "@mattermost/types/files";
import type { Post } from "@mattermost/types/posts";
import { describe, expect, it } from "vitest";
import { shouldOverrideVoiceFilePreview } from "../plugin/voice_file_preview";

function makePost(props: Post["props"]): Post {
  return {
    id: "post-id",
    create_at: 0,
    update_at: 0,
    edit_at: 0,
    delete_at: 0,
    is_pinned: false,
    user_id: "user-id",
    channel_id: "channel-id",
    root_id: "",
    original_id: "",
    message: "",
    type: "" as Post["type"],
    props,
    hashtags: "",
    pending_post_id: "",
    reply_count: 0,
    metadata: {
      embeds: [],
      emojis: [],
      files: [],
      images: {},
    },
  };
}

describe("voice file preview override", () => {
  it("suppresses Mattermost file previews only for voice message posts", () => {
    expect(
      shouldOverrideVoiceFilePreview(
        [] as FileInfo[],
        makePost({ voice_message: {} }),
      ),
    ).toBe(true);
    expect(shouldOverrideVoiceFilePreview([] as FileInfo[], makePost({}))).toBe(
      false,
    );
    expect(
      shouldOverrideVoiceFilePreview(
        [] as FileInfo[],
        makePost({ voice_message: [] }),
      ),
    ).toBe(false);
  });
});
