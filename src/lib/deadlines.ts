// Purchase & access deadlines (Africa/Algiers, UTC+1 no DST).
// Rolled forward for the 2026-2027 academic year on 2026-09-11: the previous
// dates (2026-08-31 / 2026-10-31) had already passed, which meant every new
// individual-year entitlement (free-offer claims and admin-approved
// payments alike) was granted already expired. See the matching
// private.claim_free_offer / private.approve_payment_request functions in
// supabase/migrations, which duplicate these same two dates in SQL and must
// be moved forward together with this file.
export const YEAR_DEADLINE = new Date("2027-08-31T22:59:59Z");
export const BUNDLE_DEADLINE = new Date("2027-10-31T22:59:59Z");

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
