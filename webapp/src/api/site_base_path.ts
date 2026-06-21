export function getSiteBasePath(): string {
  const basename = window.basename ?? "";
  if (!basename) {
    return "";
  }
  return basename.endsWith("/") ? basename.slice(0, -1) : basename;
}

declare global {
  interface Window {
    basename?: string;
  }
}
