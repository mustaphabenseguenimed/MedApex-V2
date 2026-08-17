import type { ExtractedQ } from "@/lib/questions.functions";
import { normalizeInlineTextColors, stripBold, stripImportedColors } from "@/lib/htmlColors";

/** Accepted shapes: [ ... ] or { questions: [ ... ] }. */
type Raw = Record<string, any>;

const str = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "object") return null; // never stringify objects/arrays
  const s = String(v).trim();
  return s ? s : null;
};

const LETTERS = "ABCDEFGHIJ";
const VRAI_COLOR = "#16a34a";
const FAUX_COLOR = "#dc2626";

/** Split plain text into one sentence per line; "à retenir" always starts a new line. */
const splitSentences = (text: string): string[] => {
  if (/<[a-z][\s\S]*>/i.test(text)) return [text];
  const withBreaks = text
    .replace(/\s*(?=(?:^|[\s.;:!?«"'\-–—])[àaÀA]\s*retenir\b)/giu, "\n")
    .replace(/(?<=[.!?…])\s+(?=[A-ZÀ-Ý0-9«"(\-–—])/gu, "\n");
  return withBreaks
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

/** Verdict of an option line from its own wording. */
const wordVerdict = (text: string): "vrai" | "faux" | null => {
  const plain = text.replace(/<[^>]*>/g, " ");
  const v = plain.search(/(^|[\s\p{P}])(vrai|vraie|vrais|vraies)($|[\s\p{P}])/iu);
  const f = plain.search(/(^|[\s\p{P}])(faux|fausse|fausses)($|[\s\p{P}])/iu);
  if (v >= 0 && f >= 0) return v <= f ? "vrai" : "faux";
  if (v >= 0) return "vrai";
  if (f >= 0) return "faux";
  return null;
};

const EXPL_KEYS = [
  "explanation", "explication", "explications", "correction", "rationale",
  "commentaire", "justification", "why", "reason", "feedback", "note", "detail", "details",
];

/** Escape plain text (JSON explanations are usually not HTML). */
const toHtml = (s: string): string =>
  /<[a-z][\s\S]*>/i.test(s)
    ? s
    : s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br />");

/** Letter/index key ("A", "a", "1", "0") -> zero-based option index. */
const keyToIndex = (k: string, len: number): number | null => {
  const s = k.trim();
  if (/^[a-zA-Z]$/.test(s)) {
    const i = s.toUpperCase().charCodeAt(0) - 65;
    return i >= 0 && i < len ? i : null;
  }
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n >= 0 && n < len) return n;
    if (n >= 1 && n <= len) return n - 1;
  }
  return null;
};

/**
 * Collect the global explanation plus every per-option explanation (option
 * objects, arrays, or letter-keyed maps) into a single HTML block, one line
 * per option, matching the AI extraction output.
 */
const buildExplanation = (o: Raw, optObjs: any[], choicesLen: number, correct: number[] = []): string | null => {
  const globalRaw = pick(o, EXPL_KEYS);
  const perOption = new Map<number, string>();
  let global: string | null = null;

  const addPer = (idx: number | null, text: string | null) => {
    if (idx == null || !text) return;
    const prev = perOption.get(idx);
    perOption.set(idx, prev ? `${prev} ${text}` : text);
  };

  // 1) per-option fields on the option objects themselves
  optObjs.forEach((c, i) => {
    if (c && typeof c === "object") addPer(i, str(pick(c as Raw, EXPL_KEYS)));
  });

  // 2) global field: string, array, or letter/index-keyed object
  if (typeof globalRaw === "string" || typeof globalRaw === "number") {
    global = str(globalRaw);
  } else if (Array.isArray(globalRaw)) {
    globalRaw.forEach((v, i) => {
      if (v && typeof v === "object") addPer(i, str(pick(v as Raw, [...EXPL_KEYS, "text", "value", "label"])));
      else addPer(i, str(v));
    });
  } else if (globalRaw && typeof globalRaw === "object") {
    Object.entries(globalRaw as Raw).forEach(([k, v]) => {
      const idx = keyToIndex(k, Math.max(choicesLen, 1));
      const text = str(v) ?? (v && typeof v === "object" ? str(pick(v as Raw, [...EXPL_KEYS, "text", "value"])) : null);
      if (idx != null) addPer(idx, text);
      else if (text) global = global ? `${global} ${text}` : text;
    });
  }

  // 3) sibling maps like { explanations: {...} } / { justifications: [...] }
  const extra = pick(o, ["explanations", "explications", "justifications", "corrections", "rationales", "option_explanations", "optionExplanations"]);
  if (Array.isArray(extra)) {
    extra.forEach((v, i) => addPer(i, typeof v === "object" && v ? str(pick(v as Raw, [...EXPL_KEYS, "text", "value"])) : str(v)));
  } else if (extra && typeof extra === "object") {
    Object.entries(extra as Raw).forEach(([k, v]) => {
      const idx = keyToIndex(k, Math.max(choicesLen, 1));
      const text = str(v) ?? (v && typeof v === "object" ? str(pick(v as Raw, [...EXPL_KEYS, "text", "value"])) : null);
      if (idx != null) addPer(idx, text);
    });
  } else if (typeof extra === "string") {
    global = global ? `${global} ${extra.trim()}` : extra.trim();
  }

  const parts: string[] = [];
  if (global) {
    const split = perOption.size ? null : splitByOptionLetters(global, choicesLen);
    if (split) {
      const firstStart = global.search(/(?:^|[\s;•·\-–—])[A-J]\s*[.)\-–—:]\s+/);
      const preamble = firstStart > 0 ? global.slice(0, firstStart).trim() : "";
      if (preamble) parts.push(...splitSentences(preamble).map((s) => `<p>${toHtml(s)}</p>`));
      split.forEach((v, k) => perOption.set(k, v));
      global = null;
    } else {
      parts.push(...splitSentences(global).map((s) => `<p>${toHtml(s)}</p>`));
    }
  }
  Array.from(perOption.keys())
    .sort((a, b) => a - b)
    .forEach((idx) => {
      const body = perOption.get(idx)!;
      const letter = LETTERS[idx] ?? String(idx + 1);
      const verdict = correct.length ? (correct.includes(idx) ? "vrai" : "faux") : wordVerdict(body);
      const color = verdict === "vrai" ? VRAI_COLOR : verdict === "faux" ? FAUX_COLOR : null;
      const head = color
        ? `<span data-vf="letter" style="color:${color};font-weight:700">${letter}.</span>`
        : `<strong>${letter}.</strong>`;
      const lines = splitSentences(body);
      lines.forEach((line, i) => {
        parts.push(i === 0 ? `<p>${head} ${toHtml(line)}</p>` : `<p>${toHtml(line)}</p>`);
      });
      if (!lines.length) parts.push(`<p>${head}</p>`);
    });
  if (!parts.length) return null;
  return normalizeInlineTextColors(parts.join(""));
};

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * Split a single explanation blob that mentions every option inline
 * ("A. ... B) ... C - ...") into per-option chunks.
 */
const splitByOptionLetters = (text: string, choicesLen: number): Map<number, string> | null => {
  if (/<[a-z][\s\S]*>/i.test(text)) return null;
  const max = Math.max(choicesLen, 1);
  const re = /(?:^|[\s;•·\-–—])([A-J])\s*[.)\-–—:]\s+/g;
  const hits: { idx: number; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const idx = m[1].charCodeAt(0) - 65;
    if (idx >= max) continue;
    hits.push({ idx, start: m.index, end: re.lastIndex });
  }
  if (hits.length < 2) return null;
  // must be increasing letters starting near A
  for (let i = 1; i < hits.length; i++) if (hits[i].idx <= hits[i - 1].idx) return null;
  const out = new Map<number, string>();
  hits.forEach((h, i) => {
    const body = text.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : text.length).trim();
    if (body) out.set(h.idx, body);
  });
  return out.size >= 2 ? out : null;
};

/** Preserve scalar and array metadata values without stringifying objects. */
const metadataValues = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  return values.map(str).filter((item): item is string => item != null);
};

/** "A" | "a" | 0 | "0" | "1" (1-based letters only) -> zero-based index. */
const toIndex = (v: unknown, choicesLen: number, choices: string[]): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) {
    const n = Math.trunc(v);
    if (n >= 0 && n < choicesLen) return n;
    if (n >= 1 && n <= choicesLen) return n - 1; // 1-based fallback
    return null;
  }
  const s = str(v);
  if (!s) return null;
  if (/^[a-zA-Z]$/.test(s)) {
    const i = s.toLowerCase().charCodeAt(0) - 97;
    return i >= 0 && i < choicesLen ? i : null;
  }
  if (/^\d+$/.test(s)) return toIndex(Number(s), choicesLen, choices);
  // Match the literal choice text.
  const norm = (x: string) => x.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const i = choices.findIndex((c) => norm(c) === norm(s));
  return i >= 0 ? i : null;
};

const pick = (o: Raw, keys: string[]): any => {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  }
  // case-insensitive fallback ("Rotation", "Year", "STEM"…)
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (real && o[real] !== undefined && o[real] !== null && o[real] !== "") return o[real];
  }
  return undefined;
};

/**
 * Detect a leading rotation (P1/R2/Rotation 3) and/or year (2023, DCEM2, …)
 * marker at the start of a stem. Returns cleaned stem plus detected hints.
 * Tolerates separators - – : | / , and enclosing () [].
 */
const ROT_RE = /^(?:(rotation|pôle|pole|rot)\.?\s*(?:n\s*°|n°|no\.?|n\.?)?\s*)?(p|r)?\s*([1-9]\d?)(?=20\d{2}|[^\dA-Za-z]|$)/i;
/**
 * Session labels that are rotations but carry no pole digit. A calendar year
 * must follow, otherwise a normal sentence starting with "rattrapage" would be
 * mistaken for a rotation marker.
 */
const SESSION_RE =
  /^(rattrapages?|ratt\.?|rat\.?|session\s+normale|normale|émd|emd)(?=[\s\-–—/:.]*20\d{2})/i;
const CAL_YEAR_RE = /^(20\d{2})(?!\d)/;
const YEAR_TOKEN_RE = /^(20\d{2}|dcem\s*[1-3]|dfasm\s*[1-3]|dfgsm\s*[1-3]|pcem\s*[1-2]|[1-7]\s*(?:ère|ere|eme|ème|er)\s*(?:année|annee|an))\b/i;
/** Separators allowed between / after markers (bullets, dashes, colons, slashes…). */
const SEP_RE = /^[\s\-‐‑‒–—―:|/,.;+&·•●▪◦*\]\)]+/;
/** Decoration allowed before a real marker (bullets, list dashes, checkmarks). */
const DECORATION_RE = /^[\s•●▪◦*✓✔☑\-‐‑‒–—―]+/;
/** A short lead-in that may precede the markers ("Externat Alger :", "QCM 12 -"). */
const LEADIN_RE = /^(?:externat|faculte|faculté|fac|universite|université|univ|centre|chu|service|module|matiere|matière|cours|source|qcm|qcs|qroc|question|q)\b[^:\-–—\n]{0,40}[:\-–—]\s*/i;
/** Leading numbering ("12.", "Q3)", "N°4 -"). */
const NUMBERING_RE = /^(?:n\s*°\s*)?\d{1,3}\s*[).:\-–—]\s*/;

/**
 * Plain-text view of a stem head (HTML tags, markdown emphasis and entities
 * removed) plus a map from each plain char back to its index in the source.
 */
function toPlainWithMap(src: string): { plain: string; map: number[] } {
  let plain = "";
  const map: number[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "<") {
      const end = src.indexOf(">", i);
      if (end !== -1) { i = end + 1; continue; }
    }
    if (ch === "&") {
      const m = src.slice(i).match(/^&(nbsp|amp|#160|#xA0);/i);
      if (m) { plain += " "; map.push(i); i += m[0].length; continue; }
    }
    if (ch === "*" || ch === "_") {
      // markdown emphasis markers
      const run = src.slice(i).match(/^[*_]{1,3}/)![0];
      i += run.length;
      continue;
    }
    if (ch === "\u00a0") { plain += " "; map.push(i); i++; continue; }
    plain += ch;
    map.push(i);
    i++;
  }
  map.push(src.length);
  return { plain, map };
}

/** Normalize a session word to a canonical rotation label prefix. */
function sessionLabel(word: string): string {
  const w = word.toLowerCase().replace(/\./g, "").trim();
  if (/^rat/.test(w)) return "Rattrapage";
  if (/normale$/.test(w)) return "Session normale";
  if (/^e?md$|^émd$/.test(w)) return "EMD";
  return word.trim();
}

/** Calendar-year metadata must be an explicit standalone 20xx value. */
function calendarYearMetadata(value: unknown): string | null {
  const raw = str(value);
  const match = raw?.match(/^\s*(20\d{2})\s*$/);
  return match?.[1] ?? null;
}

/**
 * Parse a dedicated metadata field such as `"Rotation": "P3, 2026"`,
 * `"Rattrapage 2024"` or `"Pôle 5 - 2025"`. Years listed separately from the
 * pole are glued back onto the rotation label.
 */
export function parseMarkerField(value: unknown): { rotation_hints: string[]; years: string[] } {
  const raw = str(value);
  if (!raw) return { rotation_hints: [], years: [] };
  const text = raw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const scan = scanMarkers(text);
  const years = Array.from(new Set(scan.years));
  const latest = years.length ? String(Math.max(...years.map(Number))) : null;
  const rotation_hints = Array.from(
    new Set(scan.rotation_hints.map((h) => (/20\d{2}/.test(h) || !latest ? h : `${h} ${latest}`))),
  );
  return { rotation_hints, years };
}

/** Parse one or many dedicated Rotation/Year values and deduplicate them. */
function parseMarkerFields(value: unknown): { rotation_hints: string[]; years: string[] } {
  const rotation_hints: string[] = [];
  const years: string[] = [];
  for (const raw of metadataValues(value)) {
    const parsed = parseMarkerField(raw);
    for (const hint of parsed.rotation_hints) if (!rotation_hints.includes(hint)) rotation_hints.push(hint);
    for (const year of parsed.years) if (!years.includes(year)) years.push(year);
  }
  return { rotation_hints, years };
}

/** Scan a run of leading rotation/year markers. Returns how much text it ate. */
function scanMarkers(head: string): {
  consumed: number;
  rotation_hints: string[];
  years: string[];
  year_hint: string | null;
} {
  const rotation_hints: string[] = [];
  const years: string[] = [];
  let year_hint: string | null = null;
  let consumed = 0;

  // Consume a run of leading markers: "P3 2022 • P3 2024 • P6 2026 :" or "2024 - ".
  for (let guard = 0; guard < 12; guard++) {
    const rest = head.slice(consumed);
    if (!rest) break;

    const sMatch = rest.match(SESSION_RE);
    if (sMatch) {
      let len = sMatch[0].length;
      const after = rest.slice(len);
       const gap = after.match(/^[\s\-‐‑‒–—―/:.]*/)?.[0] ?? "";
      const yMatch = after.slice(gap.length).match(CAL_YEAR_RE);
      let label = sessionLabel(sMatch[1]);
      if (yMatch) {
        label += ` ${yMatch[1]}`;
        years.push(yMatch[1]);
        len += gap.length + yMatch[0].length;
      }
      if (!rotation_hints.includes(label)) rotation_hints.push(label);
      const sep = rest.slice(len).match(SEP_RE);
      consumed += len + (sep ? sep[0].length : 0);
      if (!sep) break;
      continue;
    }

    const rMatch = rest.match(ROT_RE);
    if (rMatch && (rMatch[1] || rMatch[2])) {
      let len = rMatch[0].length;
      const afterRot = rest.slice(len);
      // optional year glued to the pole ("P3 2022")
       const gap = afterRot.match(/^[\s\-‐‑‒–—―:/(\[]*/)?.[0] ?? "";
      const yMatch = afterRot.slice(gap.length).match(CAL_YEAR_RE);
      let label = `${(rMatch[2] ?? "P").toUpperCase()}${rMatch[3]}`;
      if (yMatch) {
        label += ` ${yMatch[1]}`;
        years.push(yMatch[1]);
        len += gap.length + yMatch[0].length;
      }
      if (!rotation_hints.includes(label)) rotation_hints.push(label);
      const sep = rest.slice(len).match(SEP_RE);
      consumed += len + (sep ? sep[0].length : 0);
      if (!sep) break;
      continue;
    }

    const yOnly = rest.match(YEAR_TOKEN_RE);
    if (yOnly) {
      if (/^20\d{2}$/.test(yOnly[1])) years.push(yOnly[1]);
      else if (!year_hint) year_hint = yOnly[1];
      const sep = rest.slice(yOnly[0].length).match(SEP_RE);
      consumed += yOnly[0].length + (sep ? sep[0].length : 0);
      if (!sep) break;
      continue;
    }
    break;
  }

  return { consumed, rotation_hints, years, year_hint };
}

export function detectStemMarkers(stemRaw: string): {
  stem: string;
  rotation_hint: string | null;
  rotation_hints: string[];
  year_hint: string | null;
  year_hints: string[];
  detection_snippet: string | null;
} {
  const s = stemRaw;
  // Scan a normalized copy (HTML tags, markdown emphasis and entities removed)
  // so markers survive `<p>P3 2024 : …` and `**P3 2024** : …` openings.
  const { plain: plainFull, map } = toPlainWithMap(s.slice(0, 400));
  const head = plainFull.replace(/^[\s\[\(]+/, "");
  const headOffset = plainFull.length - head.length;

  let scan = scanMarkers(head);
  let offset = 0;
  if (!scan.rotation_hints.length && !scan.years.length && !scan.year_hint) {
    // Markers may sit behind lead-ins / numbering ("Externat Alger : P3 2024 - …", "12. P3 2024 :").
    let cursor = 0;
    for (let step = 0; step < 3; step++) {
      const rest = head.slice(cursor);
      const skip = rest.match(DECORATION_RE)?.[0] ?? rest.match(LEADIN_RE)?.[0] ?? rest.match(NUMBERING_RE)?.[0];
      if (!skip) break;
      cursor += skip.length;
      const inner = scanMarkers(head.slice(cursor));
      if (inner.rotation_hints.length || inner.years.length || inner.year_hint) {
        scan = inner;
        offset = cursor;
        break;
      }
    }
  }
  const { rotation_hints, years } = scan;
  let year_hint = scan.year_hint;
  const consumedPlain = scan.consumed ? headOffset + offset + scan.consumed : 0;
  const detectionSnippet = consumedPlain > 0
    ? plainFull.slice(0, consumedPlain).replace(/\s+/g, " ").trim()
    : null;

  // Most recent calendar year wins for exam_year.
  if (years.length) {
    year_hint = String(Math.max(...years.map(Number)));
  }
  const year_hints = Array.from(new Set(years)).sort((a, b) => Number(a) - Number(b));

  let stem = s.replace(/^[\s\[\(]+/, "");
  if (consumedPlain > 0) {
    const cut = map[Math.min(consumedPlain, map.length - 1)] ?? 0;
    // Keep any HTML tags that opened before the marker so markup stays balanced.
    const openTags = (s.slice(0, cut).match(/<[^>]*>/g) ?? []).join("");
    const cleaned = (openTags + s.slice(cut))
      // drop inline wrappers left empty by the removed marker (<strong></strong>)
      .replace(/<(strong|b|em|i|span|u)\b[^>]*>\s*<\/\1>/gi, "")
      .replace(/^[\s\[\(]+/, "")
      .trim();
    const plainLeft = cleaned.replace(/<[^>]*>/g, "").trim();
    if (plainLeft.length > 0) stem = cleaned;
  }
  return {
    stem,
    rotation_hint: rotation_hints[0] ?? null,
    rotation_hints,
    year_hint,
    year_hints,
    detection_snippet: detectionSnippet,
  };
}

const STEM_KEYS = ["stem", "question", "enonce", "énoncé", "text", "title"];
const CASE_STEM_KEYS = [
  "case_stem", "cas_clinique", "cas", "case", "enonce_commun", "énoncé_commun",
  "vignette", "observation", "contexte", "enonce", "énoncé", "stem", "text", "title",
];
const CASE_SUB_KEYS = ["questions", "sous_questions", "sub_questions", "subQuestions", "subquestions", "items", "children"];

/** A JSON node describing a clinical case: a shared vignette + its questions. */
function caseSubList(o: Raw): any[] | null {
  for (const k of CASE_SUB_KEYS) {
    const v = (o as any)[k];
    if (Array.isArray(v) && v.length > 0 && v.some((x) => x && typeof x === "object")) return v;
  }
  return null;
}
function caseStemOf(o: Raw): string | null {
  return str(pick(o, CASE_STEM_KEYS));
}
function isCaseNode(o: Raw): boolean {
  const declared = (str(pick(o, ["type", "kind"])) ?? "").toLowerCase();
  const subs = caseSubList(o);
  if (!subs) return false;
  return !!caseStemOf(o) || /cas|case|clinique|clinical|vignette/.test(declared);
}

/** Longest shared leading text between two strings, cut on a word boundary. */
function commonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

/**
 * Force every parsed question into a single clinical case: find (or derive) the
 * shared énoncé and attach it to each question as `case_stem`.
 */
function applyForcedCase(out: ExtractedQ[], record: Raw | null): void {
  if (!out.length) return;
  const explicit = record
    ? str(pick(record, [
        "case_stem", "cas_clinique", "cas", "case", "enonce_commun", "énoncé_commun",
        "vignette", "observation", "contexte", "enonce", "énoncé", "intro", "introduction",
      ]))
    : null;
  let caseStem = explicit ? stripBold(stripImportedColors(explicit)) : "";

  // No dedicated field: derive the vignette from the text every stem repeats.
  if (!caseStem && out.length > 1) {
    let shared = out[0]!.stem;
    for (let i = 1; i < out.length && shared; i++) shared = commonPrefix(shared, out[i]!.stem);
    const plain = shared.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (plain.length >= 40) {
      // cut at the last sentence end so a half-sentence never leaks into the box
      const cut = Math.max(shared.lastIndexOf("."), shared.lastIndexOf("?"), shared.lastIndexOf("!"), shared.lastIndexOf(">"));
      const vignette = cut > 0 ? shared.slice(0, cut + 1) : shared;
      caseStem = vignette.trim();
      out.forEach((q) => {
        const rest = q.stem.slice(vignette.length).replace(/^[\s:;,.–—-]+/, "").trim();
        if (rest.replace(/<[^>]*>/g, "").trim()) q.stem = rest;
      });
    }
  }

  // Still nothing: a leading "question" carrying only the vignette (no choices).
  if (!caseStem && out.length > 1 && !out[0]!.choices?.length && !out[0]!.model_answer) {
    caseStem = out[0]!.stem;
    out.splice(0, 1);
  }
  if (!caseStem) caseStem = out[0]!.stem;
  out.forEach((q) => { q.case_stem = caseStem; });
}

/** Deterministic, zero-credit parsing of a questions JSON file. */
export function parseQuestionsJson(text: string, opts?: { forceCase?: boolean }): ExtractedQ[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e: any) {
    throw new Error(`JSON invalide : ${e?.message ?? "format illisible"}`);
  }
  const record = data && typeof data === "object" && !Array.isArray(data) ? data as Raw : null;
  const rootIsCase = !!record && isCaseNode(record);
  const wrapped = record && !rootIsCase ? record.questions ?? record.items ?? record.data : null;
  const list: any[] = Array.isArray(data)
    ? data
    : Array.isArray(wrapped)
      ? wrapped
      : record && (rootIsCase || pick(record, STEM_KEYS))
        ? [record]
        : [];
  if (!list.length) throw new Error("Aucune question trouvée dans le JSON (attendu : tableau ou { questions: [...] }).");

  const out: ExtractedQ[] = [];
  const parseOne = (o: Raw, ctx?: { caseStem?: string | null; inherit?: Raw }): void => {
    const meta: Raw = ctx?.inherit ? { ...ctx.inherit, ...o } : o;
    const stemRaw = str(pick(o, STEM_KEYS));
    if (!stemRaw) return;
    const detected = detectStemMarkers(stemRaw);
    const stem = detected.stem;
    // A marker printed in the stem is the source of truth. JSON metadata is a
    // fallback only, and broad aliases (`module`, `session`) are deliberately
    // excluded because they commonly contain unrelated labels.
    // Explicit dedicated fields ("Rotation": "P3, 2026", "Year": "2026") are the
    // easiest and most reliable source, so they win over stem scanning.
    const rotationField = pick(meta, ["rotation_hints", "rotation_hint", "rotations", "rotation", "pole", "pôle"]);
    const yearField = pick(meta, ["year_hints", "year_hint", "years", "year", "annee", "année", "exam_year"]);
    const fromRotationField = parseMarkerFields(rotationField);
    const fromYearField = parseMarkerFields(yearField);
    const explicitYears = Array.from(new Set([...fromRotationField.years, ...fromYearField.years]));
    // "Rotation": "P3" + "Year": "2026" -> "P3 2026"
    const explicitRotations = fromRotationField.rotation_hints.length
      ? Array.from(new Set(fromRotationField.rotation_hints.map((h) =>
          /20\d{2}/.test(h) || !explicitYears.length
            ? h
            : `${h} ${String(Math.max(...explicitYears.map(Number)))}`)))
      : fromYearField.rotation_hints;
    const jsonYearHint = metadataValues(yearField).map(calendarYearMetadata).find((value) => value != null) ?? (explicitYears.length
      ? String(Math.max(...explicitYears.map(Number)))
      : null);
    const rotationHints = explicitRotations.length
      ? explicitRotations
      : detected.rotation_hints;
    const yearHints = explicitYears.length
      ? explicitYears.slice().sort((a, b) => Number(a) - Number(b))
      : detected.year_hints;
    const rotationHint = rotationHints[0] ?? null;
    const yearHint = yearHints.length
      ? String(Math.max(...yearHints.map(Number)))
      : (detected.year_hint ?? jsonYearHint);

    const choices = asArray(pick(o, ["choices", "options", "propositions", "answers", "reponses", "réponses"]))
      .map((c) => (typeof c === "object" && c ? str(pick(c as Raw, ["text", "label", "value", "content"])) : str(c)))
      .filter((c): c is string => !!c);

    // correct answers can be flags on the option objects, or a separate field
    let correct: number[] = [];
    const optObjs = asArray(pick(o, ["choices", "options", "propositions", "answers", "reponses", "réponses"]));
    optObjs.forEach((c, i) => {
      if (c && typeof c === "object") {
        const flag = pick(c as Raw, ["correct", "is_correct", "isCorrect", "vrai", "true"]);
        if (flag === true || flag === "true" || flag === 1) correct.push(i);
      }
    });
    if (!correct.length) {
      const rawCorrect = pick(o, [
        "correct_indices", "correctIndices", "correct", "correct_answers", "correctAnswers",
        "answer", "answers_correct", "bonnes_reponses", "reponse", "réponse",
      ]);
      const arr = Array.isArray(rawCorrect)
        ? rawCorrect
        : typeof rawCorrect === "string"
          ? rawCorrect.split(/[,;\s]+/).filter(Boolean)
          : rawCorrect != null
            ? [rawCorrect]
            : [];
      correct = arr
        .map((v) => toIndex(v, choices.length, choices))
        .filter((v): v is number => v != null);
    }
    correct = Array.from(new Set(correct)).sort((a, b) => a - b);

    const declaredType = str(pick(o, ["type", "kind"]))?.toLowerCase() ?? "";
    let type: ExtractedQ["type"];
    if (/qroc|open|ouvert|short/.test(declaredType) || choices.length === 0) type = "qroc";
    else if (/qcs|single|unique/.test(declaredType)) type = "qcs";
    else if (/qcm|multiple/.test(declaredType)) type = "qcm";
    else type = correct.length > 1 ? "qcm" : "qcs";

    out.push({
      type,
      stem: stripBold(stripImportedColors(stem)),
      choices: type === "qroc" ? null : choices.map((c) => stripBold(stripImportedColors(c))),
      correct_indices: type === "qroc" ? null : correct,
      model_answer: type === "qroc"
        ? str(pick(o, ["model_answer", "modelAnswer", "answer", "reponse", "réponse", "correction", "solution"]))
        : null,
      explanation: buildExplanation(o, optObjs, choices.length, type === "qroc" ? [] : correct),
      course_hint: str(pick(meta, ["course_hint", "course", "cours", "lesson", "lecon", "leçon", "folder"])),
      year_hint: yearHint,
      year_hints: yearHints.length ? yearHints : null,
      rotation_hint: rotationHint,
      rotation_hints: rotationHints.length ? rotationHints : null,
      detection_snippet: metadataValues(rotationField).length || metadataValues(yearField).length
        ? [...metadataValues(rotationField).map((value) => `Rotation: ${value}`), ...metadataValues(yearField).map((value) => `Year: ${value}`)].join(" · ")
        : detected.detection_snippet,
      case_stem: ctx?.caseStem ?? null,
    });
  };

  list.forEach((raw) => {
    if (!raw || typeof raw !== "object") return;
    const o = raw as Raw;
    if (isCaseNode(o)) {
      const subs = caseSubList(o) ?? [];
      const caseStem = stripBold(stripImportedColors(caseStemOf(o) ?? ""));
      if (!caseStem) return;
      subs.forEach((s) => {
        if (s && typeof s === "object") parseOne(s as Raw, { caseStem, inherit: o });
      });
      return;
    }
    parseOne(o);
  });

  if (!out.length) throw new Error("Aucune question exploitable dans le JSON (champ « stem »/« question » manquant).");
  if (opts?.forceCase && !out.some((q) => q.case_stem)) applyForcedCase(out, record);
  return out;
}
