/**
 * Retry and concurrency decisions for the conversion tool's uploads.
 *
 * The tool is used on phones as much as on laptops, where a request carrying
 * a few megabytes over a cellular link drops far more often than anything
 * does on a desk. These are the rules for "was that worth another try, and
 * how many should be in flight at once" — kept free of React and the DOM so
 * they can be tested rather than trusted.
 */

/** What `navigator.connection` gives us, where it exists at all. */
export type ConnectionInfo = {
  effectiveType?: string;
  saveData?: boolean;
} | null;

/**
 * Is this failure worth another attempt?
 *
 * Yes for a request that never completed: `fetch` rejects with a TypeError
 * when the connection drops, and a request the platform gave up on arrives as
 * a timeout. No for anything the server actually answered (a 413 is not going
 * to get smaller), and no when the admin pressed Cancel — `pass userCancelled`
 * so a deliberate abort is never mistaken for a flaky network.
 */
export function isRetryable(error: unknown, userCancelled = false): boolean {
  if (userCancelled) return false;
  const name = String((error as { name?: string } | null)?.name ?? "");
  const message = String((error as { message?: string } | null)?.message ?? "");
  if (error instanceof TypeError) return true;
  if (/failed to fetch|networkerror|load failed|connection closed/i.test(message)) return true;
  if (name === "TimeoutError") return true;
  // An abort with a timeout in its message came from the platform's own
  // deadline, not from our AbortController.
  if (name === "AbortError") return /timeout|timed out|délai/i.test(message);
  return false;
}

/**
 * Backoff between attempts, in milliseconds.
 *
 * A phone that just lost its connection needs longer than a laptop blinking
 * on wifi: a second is rarely enough for a handover between cells to settle.
 */
export function retryDelays(attempts = 3): number[] {
  return Array.from({ length: Math.max(0, attempts) }, (_, i) => 2000 * 2 ** i);
}

/**
 * How many extraction requests to keep in flight.
 *
 * Four when the connection says it can take it, two otherwise — including
 * when the browser has no Network Information API at all, which is the
 * behaviour this tool had everywhere until now. More parallel requests only
 * shortens the run while the uplink is not the bottleneck; on a metered or
 * slow connection they queue behind each other and time out instead.
 */
export function pickConcurrency(connection: ConnectionInfo): number {
  if (!connection) return 2;
  if (connection.saveData) return 2;
  return connection.effectiveType === "4g" ? 4 : 2;
}

/** `navigator.connection`, where the browser has it. */
export function currentConnection(): ConnectionInfo {
  if (typeof navigator === "undefined") return null;
  const conn = (navigator as unknown as { connection?: ConnectionInfo }).connection;
  return conn ?? null;
}
