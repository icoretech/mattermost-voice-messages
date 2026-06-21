import type { Post } from "@mattermost/types/posts";
import React, { useLayoutEffect, useRef } from "react";
import { legacyVoicePostType } from "../constants";
import { hasVoiceMessageProps } from "../voice_message_props";
import { VoicePostComponent } from "./voice_post";

export type VoicePostAttachmentProps = {
  postId?: string;
  post?: Post;
  onHeightChange?: (height: number) => void;
};

export function createVoicePostAttachmentComponent(
  getPostById: (postId: string) => Post | undefined,
): React.FC<VoicePostAttachmentProps> {
  return function VoicePostAttachment(props: VoicePostAttachmentProps) {
    const post =
      props.post ?? (props.postId ? getPostById(props.postId) : undefined);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const hasVoiceMessage = hasVoiceMessageProps(post);
    const shouldRender = Boolean(
      post &&
        post.delete_at === 0 &&
        hasVoiceMessage &&
        (post.type as string) !== legacyVoicePostType,
    );
    const heightMeasurementKey = shouldRender
      ? `${post?.id ?? ""}:${post?.update_at ?? ""}:${String(hasVoiceMessage)}`
      : "";

    useLayoutEffect(() => {
      if (!heightMeasurementKey) {
        return;
      }

      props.onHeightChange?.(rootRef.current?.offsetHeight ?? 0);
    }, [heightMeasurementKey, props.onHeightChange]);

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
