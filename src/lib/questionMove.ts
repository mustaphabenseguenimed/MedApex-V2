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
  /** The lesson (cours) it is filed under, or null when it has none. */
  folder_id: string | null;
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

/**
 * The lesson a question is filed under.
 *
 * Its own, or — when it has none — the lesson of the case it sits in. Import
 * gives a case and its questions the same one (`rowFor` in
 * importQuestions.ts writes `folder_id` on both), so the two normally agree;
 * the fallback matters for a question that was never filed, and preferring
 * the question's own is what lets an admin retarget the move menu by changing
 * its Cours rather than by taking it out of its case first.
 */
export function lessonOf(
  question: Pick<MovableQuestion, "parent_id" | "folder_id">,
  cases: Pick<MovableQuestion, "id" | "folder_id">[],
): string | null {
  if (question.folder_id) return question.folder_id;
  const parent = question.parent_id ? cases.find((c) => c.id === question.parent_id) : null;
  return parent?.folder_id ?? null;
}

/**
 * The cases this question may be moved into.
 *
 * `canMoveInto`'s rules, narrowed to the question's own lesson. The menu used
 * to list every case in the module — past twenty-seven of them on one real
 * module, each a truncated énoncé in a scrolling dropdown — when the case
 * wanted is all but always in the lesson already on screen. A question in a
 * case of another lesson is a filing error rather than something to offer, so
 * the narrowing loses nothing: an admin who means it changes the question's
 * Cours first, which leaves it correctly filed either way.
 *
 * A question with no lesson sees the cases with no lesson, so "Sans cours"
 * behaves like any other group rather than like a wildcard.
 *
 * `canMoveHere` is the same rule for one destination, so a drag and the move
 * menu can never disagree about where a question may land — and it takes the
 * null destination the menu's "Hors cas clinique" and the drag strip share.
 */
export function canMoveHere(
  question: Pick<MovableQuestion, "id" | "type" | "parent_id" | "folder_id">,
  target: Pick<MovableQuestion, "id" | "type" | "folder_id"> | null,
  cases: Pick<MovableQuestion, "id" | "folder_id">[],
): boolean {
  if (!canMoveInto(question, target)) return false;
  // Leaving every case is never narrowed: a question can always be taken out.
  if (target === null) return true;
  return (target.folder_id ?? null) === lessonOf(question, cases);
}

export function moveTargets<T extends Pick<MovableQuestion, "id" | "type" | "folder_id">>(
  question: Pick<MovableQuestion, "id" | "type" | "parent_id" | "folder_id">,
  cases: T[],
): T[] {
  return cases.filter((c) => canMoveHere(question, c, cases));
}
