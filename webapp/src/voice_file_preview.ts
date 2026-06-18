import type { FileInfo } from "@mattermost/types/files";
import type { Post } from "@mattermost/types/posts";

export function shouldOverrideVoiceFilePreview(
  _fileInfos: FileInfo[],
  post: Post,
) {
  return Boolean(post?.props?.voice_message);
}
