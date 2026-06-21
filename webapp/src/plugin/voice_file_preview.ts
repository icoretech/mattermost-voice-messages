import type { FileInfo } from "@mattermost/types/files";
import type { Post } from "@mattermost/types/posts";
import { hasVoiceMessageProps } from "../voice_message_props";

export function shouldOverrideVoiceFilePreview(
  _fileInfos: FileInfo[],
  post: Post,
) {
  return hasVoiceMessageProps(post);
}
