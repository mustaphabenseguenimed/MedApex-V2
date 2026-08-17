/**
 * The Data API caps every response at 1000 rows, so a plain select silently
 * truncates large modules. fetchAllRows pages through the full result set.
 */
const PAGE = 1000;

export async function fetchAllRows<T = any>(
  build: () => any,
  pageSize = PAGE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
