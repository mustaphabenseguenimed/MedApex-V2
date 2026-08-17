// Purchase & access deadlines (Africa/Algiers, UTC+1 no DST).
export const YEAR_DEADLINE = new Date("2026-08-31T22:59:59Z");
export const BUNDLE_DEADLINE = new Date("2026-10-31T22:59:59Z");

export function deadlineFor(isBundle: boolean): Date {
  return isBundle ? BUNDLE_DEADLINE : YEAR_DEADLINE;
}

export function isExpired(expiresAt: string | Date | null | undefined): boolean {
  if (!expiresAt) return false;
  const d = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return d.getTime() <= Date.now();
}

export function isSalesClosed(isBundle: boolean): boolean {
  return Date.now() > deadlineFor(isBundle).getTime();
}

export function formatDeadline(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}