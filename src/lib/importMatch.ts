// Client-side matchers to auto-fill rotation/folder/year from AI hints.

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokens = (s: string) =>
  norm(s)
    .split(" ")
    .filter((t) => t.length >= 3);

type Rotation = { id: string; label: string };
type Folder = { id: string; name: string; kind: string };

type HintedQuestion = {
  year_hint?: string | null;
  year_hints?: (string | null | undefined)[] | null;
  rotation_hint?: string | null;
  rotation_hints?: (string | null | undefined)[] | null;
};

/** Extract the pole number (P3/R3/Rotation 3) and calendar year from a label. */
function poleYear(s: string): { pole: number | null; year: number | null } {
  const n = norm(s);
  // Glued form: "p32024" -> pole 3, year 2024.
  const glued = n.match(/\b([pr])\s*([1-9]\d?)(20\d{2})\b/);
  if (glued) return { pole: Number(glued[2]), year: Number(glued[3]) };
  const year = n.match(/(?<!\d)(20\d{2})(?!\d)/);
  const withoutYear = year ? n.replace(year[1], " ") : n;
  const pole =
    withoutYear.match(/\b[pr]\s*([1-9]\d?)\b/) ??
    withoutYear.match(/\brotation\s*([1-9]\d?)\b/) ??
    withoutYear.match(/\bpole\s*([1-9]\d?)\b/) ??
    withoutYear.match(/\brot\s*([1-9]\d?)\b/) ??
    withoutYear.match(/\b(?:rotation|pole|rot)\s*n?\s*([1-9]\d?)\b/);
  return { pole: pole ? Number(pole[1]) : null, year: year ? Number(year[1]) : null };
}

/** Words that identify a non-pole session rotation ("Rattrapage 2025"). */
function sessionWord(s: string): string | null {
  const n = norm(s);
  if (/\brat(t|trapage|trapages)?\b/.test(n) || /\brattrapage/.test(n)) return "rattrapage";
  if (/\bnormale\b/.test(n)) return "normale";
  if (/\bemd\b/.test(n)) return "emd";
  return null;
}

type MatchOpts = { years?: (number | string | null | undefined)[] };

/** Canonical identity shared by imported hints and stored rotation labels. */
export function canonicalRotationKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const word = sessionWord(value);
  const parsed = poleYear(value);
  if (word) return parsed.year == null ? null : `${word}:${parsed.year}`;
  if (parsed.pole == null || parsed.year == null) return null;
  return `pole:${parsed.pole}:${parsed.year}`;
}

/** Pick, among candidates, the one whose year fits the context best. */
function pickByYear(
  candidates: { id: string; year: number | null }[],
  years: number[],
): string | null {
  if (!candidates.length) return null;
  for (const y of years) {
    const hit = candidates.find((c) => c.year === y);
    if (hit) return hit.id;
  }
  const withYear = candidates.filter((c) => c.year != null);
  if (withYear.length) {
    return withYear.reduce((a, b) => ((b.year ?? 0) > (a.year ?? 0) ? b : a)).id;
  }
  return candidates[0].id;
}

/** Match a rotation hint like "P1 2026", "Rotation 2", "R3" to an existing rotation. */
export function matchRotation(
  hint: string | null | undefined,
  rotations: Rotation[],
  opts: MatchOpts = {},
): string | null {
  if (!hint || rotations.length === 0) return null;
  const h = norm(hint);
  if (!h) return null;
  const ctxYears = Array.from(
    new Set(
      (opts.years ?? []).map((y) => Number(y)).filter((y) => Number.isFinite(y) && y >= 2000),
    ),
  ).sort((a, b) => b - a);

  // Imported stem markers with a year are exact identities. Never silently
  // assign them to a different stored year or pole.
  const exactKey = canonicalRotationKey(hint);
  if (exactKey) {
    return (
      rotations.find((rotation) => canonicalRotationKey(rotation.label) === exactKey)?.id ?? null
    );
  }

  // 1. exact normalized equality
  for (const r of rotations) if (norm(r.label) === h) return r.id;

  // 1b. session rotations ("Rattrapage 2025") never match a pole rotation.
  const hWord = sessionWord(hint);
  if (hWord) {
    const hYear = poleYear(hint).year;
    const cands = rotations
      .filter((r) => sessionWord(r.label) === hWord)
      .map((r) => ({ id: r.id, year: poleYear(r.label).year }));
    if (!cands.length) return null;
    if (hYear != null) return cands.find((c) => c.year === hYear)?.id ?? null;
    return pickByYear(cands, ctxYears);
  }

  // 2. pole (+ year) equality — labels often combine both ("P2 2025").
  const hp = poleYear(hint);
  if (hp.pole != null) {
    const fallbacks: { id: string; year: number | null }[] = [];
    for (const r of rotations) {
      const rp = poleYear(r.label);
      if (rp.pole !== hp.pole) continue;
      if (sessionWord(r.label)) continue;
      if (hp.year != null && rp.year != null) {
        if (hp.year === rp.year) return r.id;
        continue;
      }
      // one side has no year: acceptable, resolved by year context below.
      fallbacks.push({ id: r.id, year: rp.year });
    }
    // A hint carrying a pole must never match a rotation with a different pole.
    return pickByYear(fallbacks, ctxYears);
  }

  // 3. substring either way (only for hints without a pole digit)
  for (const r of rotations) {
    const n = norm(r.label);
    if (sessionWord(r.label)) continue;
    if (n && (h.includes(n) || n.includes(h))) return r.id;
  }

  // 4. digit + prefix letter equality, reserved for genuinely yearless hints.
  const hDigits = (h.match(/\d+/g) ?? []).join("");
  const hLetter = h.replace(/[^a-z]/g, "").slice(0, 1); // p, r, ...
  if (hDigits) {
    for (const r of rotations) {
      const n = norm(r.label);
      if (sessionWord(r.label)) continue;
      const nDigits = (n.match(/\d+/g) ?? []).join("");
      const nLetter = n.replace(/[^a-z]/g, "").slice(0, 1);
      const lettersCompatible =
        !hLetter ||
        !nLetter ||
        hLetter === nLetter ||
        // P/R prefixes (and "rotation") are used interchangeably across sources.
        (["p", "r"].includes(hLetter) && ["p", "r"].includes(nLetter));
      if (nDigits === hDigits && lettersCompatible) return r.id;
    }
  }
  return null;
}

/** The displayed rotation is the last one in the module's rotation order. */
export function primaryRotation(
  ids: string[] | null | undefined,
  rotations: Rotation[],
): string | null {
  const set = new Set(ids ?? []);
  let last: string | null = null;
  for (const r of rotations) if (set.has(r.id)) last = r.id;
  return last ?? (ids && ids.length ? ids[ids.length - 1] : null);
}

/** Auto-fill rotation(s)/year(s) for an extracted question from its hints. */
export function resolveImportAssignments(q: HintedQuestion, rotations: Rotation[]) {
  const years = parseYears(q.year_hints ?? [q.year_hint], q.year_hint);
  const rotationIds = matchRotations(q.rotation_hints ?? [q.rotation_hint], rotations, { years });
  const rotationId = primaryRotation(rotationIds, rotations);
  const latest = years.length ? Math.max(...years) : null;
  return {
    rotation_id: rotationId ?? "__none",
    rotation_ids: rotationIds,
    exam_year: latest != null ? String(latest) : "__none",
    exam_years: years.map(String),
    year_detected: latest,
  };
}

/** Match several rotation hints ("P3 2022", "P6 2026") to rotation ids, deduped. */
export function matchRotations(
  hints: (string | null | undefined)[] | null | undefined,
  rotations: Rotation[],
  opts: MatchOpts = {},
): string[] {
  const out: string[] = [];
  for (const h of hints ?? []) {
    const id = matchRotation(h, rotations, opts);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Match a course hint to a folder via token overlap (Jaccard). */
export function parseYears(
  hints: (string | null | undefined)[] | null | undefined,
  fallback?: string | null,
): number[] {
  const out: number[] = [];
  for (const h of hints ?? []) {
    const y = parseYear(h);
    if (y != null && !out.includes(y)) out.push(y);
  }
  if (!out.length) {
    const y = parseYear(fallback);
    if (y != null) out.push(y);
  }
  return out.sort((a, b) => a - b);
}

export function matchFolder(
  hint: string | null | undefined,
  folders: Folder[],
  opts: { kinds?: string[]; threshold?: number } = {},
): string | null {
  if (!hint || folders.length === 0) return null;
  const pool = opts.kinds ? folders.filter((f) => opts.kinds!.includes(f.kind)) : folders;
  if (pool.length === 0) return null;
  const threshold = opts.threshold ?? 0.28;

  const hTokens = new Set(tokens(hint));
  if (hTokens.size === 0) return null;

  let best: { id: string; score: number; prefix: number } | null = null;
  for (const f of pool) {
    const fTokens = new Set(tokens(f.name));
    if (fTokens.size === 0) continue;
    let inter = 0;
    for (const t of hTokens) if (fTokens.has(t)) inter++;
    const union = new Set([...hTokens, ...fTokens]).size;
    // Jaccard, boosted by containment: a folder name fully contained in the
    // hint (or vice-versa) is a strong match even when the hint is longer.
    const jaccard = inter / union;
    const containment = inter / Math.min(hTokens.size, fTokens.size);
    const a0 = norm(f.name);
    const b0 = norm(hint);
    const substring = a0 && b0 && (b0.includes(a0) || a0.includes(b0)) ? 1 : 0;
    const score = Math.max(jaccard, containment * 0.9, substring);
    // common prefix length (normalized strings) as tiebreaker
    const a = norm(f.name);
    const b = norm(hint);
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    if (
      score >= threshold &&
      (!best || score > best.score || (score === best.score && prefix > best.prefix))
    ) {
      best = { id: f.id, score, prefix };
    }
  }
  return best?.id ?? null;
}

/**
 * Parse a year hint like "3ème année", "DCEM2", "4A" to a small integer.
 * A bare digit is never treated as a year: "P1" is a rotation, not year 1.
 */
export function parseYear(hint: string | null | undefined): number | null {
  if (!hint) return null;
  const raw = hint.trim();
  // A pure rotation label carries no year information.
  if (/^\s*[pr]\s?\d{1,2}\s*$/i.test(raw)) return null;
  const h = norm(hint);
  // 4-digit calendar year (2000-2099) used as exam_year. Must be a standalone
  // run of exactly 4 digits so we don't misread ids like "202312".
  const cal = h.match(/(?<!\d)(20\d{2})(?!\d)/);
  if (cal) return Number(cal[1]);
  // DCEM1..3 => 3,4,5 (approx). PCEM1..2 => 1,2.
  const dcem = h.match(/dcem\s*([1-3])/);
  if (dcem) return Number(dcem[1]) + 2;
  const pcem = h.match(/pcem\s*([1-2])/);
  if (pcem) return Number(pcem[1]);
  const dfgsm = h.match(/dfgsm\s*([1-3])/);
  if (dfgsm) return Number(dfgsm[1]);
  const dfasm = h.match(/dfasm\s*([1-3])/);
  if (dfasm) return Number(dfasm[1]) + 3;
  const eme = h.match(/([1-7])\s*(?:eme|ere|er)?\s*(?:annee|an)\b/);
  if (eme) return Number(eme[1]);
  // "4A" / "A4" style, but only when the letter A is a standalone marker.
  const a = h.match(/\b([1-7])\s*a\b/);
  if (a) return Number(a[1]);
  const a2 = h.match(/\ba\s*([1-7])\b/);
  if (a2) return Number(a2[1]);
  return null;
}
