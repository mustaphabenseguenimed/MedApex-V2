/**
 * Rules for moving a question between clinical cases in a module's question
 * list — which drops are legal, and where the moved question lands.
 *
 * Kept free of React and supabase so the rules can be tested on their own,
 * like questionsJson.ts and importQuestions.ts.
 */

/** The little a move needs to know about a question. */
export type MovableQuestion = {
  id: string;
  /** "cas_clinique" for a case; anything else is a question. */
  type: string;
  /** The case it currently belongs to, or null when standalone. */
  parent_id: string | null;
  sort_order: number | null;
};

/** A question can be moved; a clinical case cannot — cases do not nest. */
export function isMovable(q: Pick<MovableQuestion, "type">): boolean {
  return q.type !== "cas_clinique";
}

/**
 * May `dragged` be dropped into `target`?
 *
 * `target` is the destination case, or null for "out of every case". False
 * for a case being dragged, for a target that is not a case, and for the
 * question's current home — dropping something where it already is must not
 * write anything.
 */
export function canMoveInto(
  dragged: Pick<MovableQuestion, "id" | "type" | "parent_id">,
  target: Pick<MovableQuestion, "id" | "type"> | null,
): boolean {
  if (!isMovable(dragged)) return false;
  if (target === null) return dragged.parent_id !== null;
  if (target.type !== "cas_clinique") return false;
  if (target.id === dragged.id) return false;
  return dragged.parent_id !== target.id;
}

/**
 * Sort order for a question appended after `siblings`.
 *
 * Tolerates the orders the table actually holds: nulls, duplicates and values
 * out of order (the list keeps `reindexIfNeeded` for the same reason), so the
 * moved question still lands last instead of jumping to the top.
 */
export function nextSortOrder(siblings: Pick<MovableQuestion, "sort_order">[]): number {
  const highest = siblings.reduce(
    (max, s) => (typeof s.sort_order === "number" && s.sort_order > max ? s.sort_order : max),
    0,
  );
  return highest + 10;
}

/**
 * The single row update a drop comes down to, or null when the drop changes
 * nothing and must not hit the database.
 *
 * `siblings` are the questions already in the destination — the target case's
 * children, or the module's top-level questions when leaving a case.
 */
export function planMove(
  dragged: Pick<MovableQuestion, "id" | "type" | "parent_id">,
  target: Pick<MovableQuestion, "id" | "type"> | null,
  siblings: Pick<MovableQuestion, "sort_order">[],
): { parent_id: string | null; sort_order: number } | null {
  if (!canMoveInto(dragged, target)) return null;
  return { parent_id: target ? target.id : null, sort_order: nextSortOrder(siblings) };
}
