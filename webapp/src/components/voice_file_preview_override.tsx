import type { FileInfo } from "@mattermost/types/files";
import type { Post } from "@mattermost/types/posts";
import React from "react";

type FilePreviewProps = {
  fileInfos?: FileInfo[];
  post?: Post;
};

export function VoiceFilePreviewOverride(_props: FilePreviewProps) {
  return null;
}
