import { getSiteBasePath } from "../api/site_base_path";

export function getMattermostFileUrl(fileId: string, timestamp = 0): string {
  return `${getSiteBasePath()}/api/v4/files/${fileId}?t=${timestamp}`;
}
