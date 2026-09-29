/**
 * A question's énoncé as the admin edits it, and back again.
 *
 * The énoncé is stored as light HTML, and an association question keeps its
 * numbered propositions one per line — separated by `<br />`. The edit field
 * is a plain textarea, so those tags sat in it as literal text: six "<br />"
 * scattered through the sentence the admin was trying to read, and a list
 * that ran on as one paragraph.
 *
 * Only the line breaks are translated. Anything else the énoncé carries — an
 * image, a <strong> — is left exactly as it is, rather than being dropped by
 * a field that does not understand it.
 */

/** The énoncé shown in the editor: its line breaks as real ones. */
export function stemToEditable(html: string | null | undefined): string {
  return (html ?? "").replace(/<br\s*\/?>/gi, "\n");
}

/** The énoncé as it is stored, back from what the editor holds. */
export function editableToStem(text: string): string {
  return (text ?? "").replace(/\r\n?|\n/g, "<br />");
}
