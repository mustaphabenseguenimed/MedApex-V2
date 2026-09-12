// Purchase & access deadlines.
//
// These used to be hardcoded constants here (and duplicated again inside
// private.claim_free_offer / private.approve_payment_request in SQL), which
// meant changing them needed a code deploy AND a migration — and is exactly
// how they went stale once (see migration 20260911120000). They now live in
// pricing_config (year_deadline / bundle_deadline), editable from
// Admin → Tarifs, and the same two columns are what those SQL functions
// read. The constants below are only the fallback used before that row has
// loaded, or if a field ever comes back null/invalid.
export const DEFAULT_YEAR_DEADLINE = new Date("2027-08-31T22:59:59Z");
export const DEFAULT_BUNDLE_DEADLINE = new Date("2027-10-31T22:59:59Z");

/** Turn a pricing_config timestamp column (or its absence) into a Date. */
export function parseDeadline(v: string | null | undefined, fallback: Date): Date {
  if (!v) return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export function isExpired(expiresAt: string | Date | null | undefined): boolean {
  if (!expiresAt) return false;
  const d = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return d.getTime() <= Date.now();
}

export function isSalesClosed(deadline: Date): boolean {
  return Date.now() > deadline.getTime();
}

export function formatDeadline(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}
