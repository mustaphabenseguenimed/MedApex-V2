/**
 * Packing several reference documents into one prompt section.
 *
 * Step 2 can be given a handful of sources at once (course chapters as PDF
 * or Word, plus pasted notes). The prompts that consume them have a fixed
 * character budget, and the naive approach — concatenate, then slice to the
 * budget — silently drops every document after the first once the total goes
 * over. Accepting several files and then ignoring most of them is worse than
 * accepting one, so the budget is shared instead.
 */

export type ReferenceDoc = { name: string; text: string };

/** Marks where a document was cut, so the model does not read a sentence
 *  that stops mid-thought as the document's actual end. */
const TRUNCATION_MARK = "\n…[document tronqué]";

/**
 * Build the labelled reference block, within `budget` characters of document
 * text, and report which documents did not fit whole.
 *
 * The share is water-filled: documents are served shortest-first, each taking
 * at most an equal share of what is left, so whatever a short document does
 * not use passes to the longer ones. Everything fits when the total fits; when
 * it does not, every document still gets a fair slice rather than the first
 * one eating the whole budget.
 */
export function buildReferenceBlock(
  docs: ReferenceDoc[],
  budget: number,
): { block: string; truncated: string[] } {
  // Fresh objects, so they are unique Map keys even when two files happen to
  // share a name.
  const usable: ReferenceDoc[] = docs
    .map((d) => ({ name: (d.name || "Document").trim(), text: (d.text ?? "").trim() }))
    .filter((d) => d.text.length > 0);
  if (!usable.length || budget <= 0) return { block: "", truncated: [] };

  const take = new Map<ReferenceDoc, number>();
  let remaining = budget;
  // Shortest first: the leftover from a small document is then still
  // available to the ones that need it.
  [...usable]
    .sort((a, b) => a.text.length - b.text.length)
    .forEach((doc, i, sorted) => {
      const share = Math.floor(remaining / (sorted.length - i));
      const allowed = Math.min(doc.text.length, share);
      take.set(doc, allowed);
      remaining -= allowed;
    });

  const truncated: string[] = [];
  const sections = usable.map((doc) => {
    const allowed = take.get(doc) ?? 0;
    const whole = allowed >= doc.text.length;
    if (!whole) truncated.push(doc.name);
    const body = whole ? doc.text : doc.text.slice(0, allowed) + TRUNCATION_MARK;
    return `=== ${doc.name} ===\n${body}`;
  });

  return { block: sections.join("\n\n"), truncated };
}
