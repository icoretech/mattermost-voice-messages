import type { Post } from "@mattermost/types/posts";
import React, { useLayoutEffect, useRef } from "react";
import { voicePostType } from "../constants";
import { VoicePostComponent } from "./voice_post";

export type VoicePostAttachmentProps = {
  postId?: string;
  post?: Post;
  onHeightChange?: (height: number) => void;
};

function getVoiceMessageProps(post: Post): Record<string, unknown> | undefined {
  const voiceMessage = post.props?.voice_message;
  if (
    !voiceMessage ||
    typeof voiceMessage !== "object" ||
    Array.isArray(voiceMessage)
  ) {
    return undefined;
  }

  return voiceMessage as Record<string, unknown>;
}

export function createVoicePostAttachmentComponent(
  getPostById: (postId: string) => Post | undefined,
): React.FC<VoicePostAttachmentProps> {
  return function VoicePostAttachment(props: VoicePostAttachmentProps) {
    const post =
      props.post ?? (props.postId ? getPostById(props.postId) : undefined);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const voiceMessage = post ? getVoiceMessageProps(post) : undefined;
    const postId = post?.id;
    const postUpdateAt = post?.update_at;
    const shouldRender = Boolean(
      post &&
        post.delete_at === 0 &&
        voiceMessage &&
        (post.type as string) !== voicePostType,
    );

    useLayoutEffect(() => {
      if (!shouldRender) {
        return;
      }

      void postId;
      void postUpdateAt;
      void voiceMessage;

      props.onHeightChange?.(rootRef.current?.offsetHeight ?? 0);
    }, [
      shouldRender,
      postId,
      postUpdateAt,
      voiceMessage,
      props.onHeightChange,
    ]);

    if (!post || !shouldRender) {
      return null;
    }

    return (
      <div className="VoiceMessagePostAttachment" ref={rootRef}>
        <VoicePostComponent post={post} />
      </div>
    );
  };
}
