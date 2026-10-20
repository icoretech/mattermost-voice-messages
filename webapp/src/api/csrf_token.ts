// Mirrors Client4.getCSRFFromCookie: Mattermost stores the session CSRF token
// in the MMCSRF cookie and expects it back in the X-CSRF-Token header.
export function getCsrfToken(): string {
  for (const cookie of document.cookie.split(";")) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith("MMCSRF=")) {
      return trimmed.slice("MMCSRF=".length);
    }
  }
  return "";
}
