import "@testing-library/jest-dom/vitest";
import type { Post } from "@mattermost/types/posts";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { voicePostType } from "../constants";
import { createVoicePostAttachmentComponent } from "./voice_post_attachment";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-id",
    create_at: 0,
    update_at: 123,
    edit_at: 0,
    delete_at: 0,
    is_pinned: false,
    user_id: "user-id",
    channel_id: "channel-id",
    root_id: "",
    original_id: "",
    message: "",
    type: "",
    props: {},
    hashtags: "",
    pending_post_id: "",
    reply_count: 0,
    metadata: {
      embeds: [],
      emojis: [],
      files: [],
      images: {},
    },
    ...overrides,
  };
}

let createdAudios: HTMLAudioElement[] = [];

function FakeAudio(_src?: string) {
  const audio = document.createElement("audio");
  if (_src) {
    audio.setAttribute("src", _src);
  }
  createdAudios.push(audio);
  return audio;
}

function getCreatedAudio() {
  const audio = createdAudios.at(-1);
  if (!audio) {
    throw new Error("Expected VoiceAudioPlayer to create an audio element");
  }
  return audio;
}

describe("VoicePostAttachment", () => {
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalPause = HTMLMediaElement.prototype.pause;

  beforeEach(() => {
    createdAudios = [];
    HTMLMediaElement.prototype.pause = vi.fn();
    vi.stubGlobal("Audio", FakeAudio);
  });

  afterEach(() => {
    cleanup();
    HTMLMediaElement.prototype.play = originalPlay;
    HTMLMediaElement.prototype.pause = originalPause;
    vi.unstubAllGlobals();
  });

  it("renders a normal voice post as a custom player", () => {
    const Attachment = createVoicePostAttachmentComponent(() => undefined);

    render(
      <Attachment
        post={makePost({
          file_ids: ["file-id"],
          props: { voice_message: { duration_ms: 1_000 } },
        })}
      />,
    );

    expect(getCreatedAudio()).toHaveAttribute(
      "src",
      "/api/v4/files/file-id?t=123",
    );
    expect(
      screen.getByRole("button", { name: "Play voice message" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("resolves a post from postId", () => {
    const post = makePost({
      file_ids: ["resolved-file"],
      props: { voice_message: { duration_ms: 1_000 } },
    });
    const getPostById = vi.fn(() => post);
    const Attachment = createVoicePostAttachmentComponent(getPostById);

    render(<Attachment postId="post-id" />);

    expect(getPostById).toHaveBeenCalledWith("post-id");
    expect(getCreatedAudio()).toHaveAttribute(
      "src",
      "/api/v4/files/resolved-file?t=123",
    );
  });

  it("returns no player without voice message props", () => {
    const Attachment = createVoicePostAttachmentComponent(() => undefined);

    const { container } = render(<Attachment post={makePost()} />);

    expect(container).toBeEmptyDOMElement();
    expect(createdAudios).toHaveLength(0);
  });

  it("returns no player for deleted voice posts", () => {
    const Attachment = createVoicePostAttachmentComponent(() => undefined);

    const { container } = render(
      <Attachment
        post={makePost({
          delete_at: 1,
          file_ids: ["file-id"],
          props: { voice_message: { duration_ms: 1_000 } },
        })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(createdAudios).toHaveLength(0);
  });

  it("reports height after rendering a voice post", () => {
    const Attachment = createVoicePostAttachmentComponent(() => undefined);
    const onHeightChange = vi.fn();

    render(
      <Attachment
        post={makePost({
          file_ids: ["file-id"],
          props: { voice_message: { duration_ms: 1_000 } },
        })}
        onHeightChange={onHeightChange}
      />,
    );

    expect(onHeightChange).toHaveBeenCalled();
  });

  it("does not duplicate historical custom voice posts", () => {
    const Attachment = createVoicePostAttachmentComponent(() => undefined);

    const { container } = render(
      <Attachment
        post={makePost({
          type: voicePostType as Post["type"],
          file_ids: ["file-id"],
          props: { voice_message: { duration_ms: 1_000 } },
        })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(createdAudios).toHaveLength(0);
  });
});
