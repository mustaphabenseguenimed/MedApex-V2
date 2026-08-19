// Prefer an explicit VITE_SITE_URL so auth redirect links are correct even if
// the app is ever loaded through a proxy/preview domain that shouldn't be used
// for links sent by email. Falls back to the browser's current origin.
export function getSiteUrl(): string {
  const configured = import.meta.env.VITE_SITE_URL as string | undefined;
  return configured?.replace(/\/$/, "") || window.location.origin;
}
