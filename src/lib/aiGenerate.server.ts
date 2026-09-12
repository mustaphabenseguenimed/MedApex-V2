/**
 * The shared structured-AI call layer: one place for the model choice, safety
 * settings, timeout and retry/backoff policy used by every extraction and
 * explanation call.
 *
 * Server-only (`.server` suffix): it reaches the Gemini provider, so importing
 * it from anything the client bundle can reach is blocked at build time. Call
 * it from inside `createServerFn().handler()` bodies only.
 */
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";
import { getExtractModelCandidates, type ExtractEngine } from "./ai-extract-provider.server";
import { getGeminiProvider } from "./ai-provider.server";

export type AiContent = Array<
  | { type: "text"; text: string }
  | { type: "image"; image: string }
  | { type: "file"; data: string; mediaType: string; filename?: string }
>;

/** Surface a friendly error when the AI gateway rejects a request (credits,
 *  quota, auth). Otherwise re-throw the original error. */
export function friendlyGatewayError(error: unknown): Error {
  const anyErr = error as any;
  const status: number | undefined =
    anyErr?.statusCode ?? anyErr?.status ?? anyErr?.response?.status ?? anyErr?.cause?.statusCode;
  const raw: string = String(anyErr?.message ?? anyErr?.responseBody ?? "");
  if (status === 402 || /payment required|insufficient/i.test(raw)) {
    return new Error("Crédits IA épuisés. Ajoutez des crédits à l'espace de travail.");
  }
  if (/quota|credit/i.test(raw)) {
    return new Error("Quota IA atteint. Réessayez plus tard.");
  }
  if (status === 401 || status === 403) {
    return new Error("Accès IA refusé. Réessayez.");
  }
  if (status === 429) {
    return new Error("Trop de requêtes IA en parallèle. Réessayez dans quelques secondes.");
  }
  if (anyErr?.name === "TimeoutError" || /aborted.*timeout|timed? ?out/i.test(raw)) {
    return new Error(
      "Le traitement a dépassé le délai imparti (fichier volumineux ou page complexe). Réessayez, ou traitez moins de pages/fichiers à la fois.",
    );
  }
  if (error instanceof Error) return error;
  return new Error(raw || "Erreur IA inconnue");
}

/** Extract the "Please retry in Ns" delay Google returns on 429, in ms. */
export function retryDelayMs(error: unknown, attempt: number): number {
  const raw = String((error as any)?.message ?? (error as any)?.responseBody ?? "");
  const m = raw.match(/retry in ([\d.]+)s/i);
  if (m) return Math.min(45_000, Math.ceil(parseFloat(m[1]) * 1000) + 500);
  return Math.min(20_000, 1500 * 2 ** attempt);
}

function errorStatus(error: unknown): number | undefined {
  const e = error as any;
  return e?.statusCode ?? e?.status ?? e?.response?.status ?? e?.cause?.statusCode;
}

/** 429 / 5xx are transient: worth waiting and retrying the same model. */
export function isTransient(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;
  return /rate.?limit|overloaded|unavailable|RESOURCE_EXHAUSTED|timeout/i.test(
    String((error as any)?.message ?? ""),
  );
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Medical exam content (oncology, obstetrics, toxicology, sexual health) is
 *  routinely misread as unsafe by default filters, which silently costs a whole
 *  chunk. This is an admin-only tool operating on the school's own exam papers,
 *  so nothing here should be filtered on content grounds. */
const SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

/**
 * Hard ceiling on the *total* time generateWithFallback will spend across
 * every model, attempt and backoff sleep combined.
 *
 * Without this, the retry loop below has no bound on wall-clock time: worst
 * case is 2 models x 4 attempts, each attempt allowed up to 150s before its
 * own timeout fires, plus up to 45s of backoff between attempts — north of
 * 24 minutes for a single server function call. No Vercel plan lets a
 * function run anywhere near that; the platform kills the invocation outright
 * and the browser shows Vercel's own generic crash page instead of any error
 * message this app controls — indistinguishable from a real outage, and it
 * happens on every step since they all funnel through this one function.
 * Kept comfortably under typical serverless duration caps so this function
 * always resolves — success or a clean thrown error — well before the
 * platform would step in.
 *
 * 280s (not less): extraction runs with `thinking: true` on image-heavy
 * content, and a single earnest attempt on a large/complex chunk can
 * legitimately take well over 150s. A tighter budget was cutting those off
 * mid-attempt — same content, same result, just a faster, cleaner failure
 * instead of a slow one. Retries only rescue *transient* failures (rate
 * limits, overload), which fail fast; genuine slowness needs room on the
 * first try, not more attempts at the same wall.
 */
export const TOTAL_DEADLINE_MS = 280_000;

/** A structured (schema-validated) AI call, over the shared model candidates
 *  and retry policy in `runWithCandidates` below. */
export async function generateWithFallback<T>(
  schema: z.ZodType<T>,
  content: AiContent,
  opts?: {
    temperature?: number;
    timeoutMs?: number;
    thinking?: boolean;
    /** Absolute Date.now()-style deadline, shared across a whole tree of
     *  calls (e.g. a chunk's recursive re-split attempts) instead of each
     *  call getting its own fresh TOTAL_DEADLINE_MS. Defaults to a fresh
     *  deadline starting now, same as before this option existed. */
    deadlineAt?: number;
  },
): Promise<{ output: T; engine: ExtractEngine }> {
  return runWithCandidates(
    async (model, remainingMs) => {
      const { output } = await generateText({
        model,
        output: Output.object({ schema }),
        // Never let a single attempt outlive the overall budget, even if the
        // caller asked for a longer per-attempt timeout.
        abortSignal: AbortSignal.timeout(
          Math.max(1000, Math.min(opts?.timeoutMs ?? 150_000, remainingMs)),
        ),
        messages: [{ role: "user", content: content as any }],
        temperature: opts?.temperature ?? 0.2,
        providerOptions: {
          google: {
            safetySettings: SAFETY_SETTINGS,
            // "medium", not "high": high-effort thinking on every extraction
            // call was the single biggest contributor to conversion latency.
            // Medium keeps the reasoning pass that improved extraction
            // accuracy, just with a smaller budget, at meaningfully lower cost
            // per call.
            ...(opts?.thinking ? { thinkingConfig: { thinkingLevel: "medium" } } : {}),
          },
        },
      });
      return output;
    },
    opts?.deadlineAt ?? Date.now() + TOTAL_DEADLINE_MS,
  );
}

/**
 * A web-grounded text call: same models, safety settings, timeout and retry
 * policy as above, but with Google Search attached so the model can check a
 * claim against current sources instead of only its training data.
 *
 * Text, not a schema, on purpose: Gemini rejects a `responseSchema` combined
 * with tools, so a grounded call cannot use `Output.object`. Callers ask for
 * a strict line format in the prompt and parse it leniently — an unreadable
 * line has to mean "no answer", never a wrong one.
 */
export async function generateGroundedText(
  prompt: string,
  opts?: { temperature?: number; timeoutMs?: number; deadlineAt?: number },
): Promise<{ text: string; sources: string[]; engine: ExtractEngine }> {
  const google = getGeminiProvider();
  if (!google) throw new Error("Moteur IA indisponible.");

  const { output, engine } = await runWithCandidates(
    async (model, remainingMs) => {
      const result = await generateText({
        model,
        // Cast: @ai-sdk/google's provider-executed tool type doesn't line up
        // with the `ai` package's Tool union across these two major versions.
        // The wire shape is what Gemini wants — the name must be exactly
        // "google_search" — only the generic parameters disagree.
        tools: { google_search: google.tools.googleSearch({}) as any },
        abortSignal: AbortSignal.timeout(
          Math.max(1000, Math.min(opts?.timeoutMs ?? 120_000, remainingMs)),
        ),
        prompt,
        temperature: opts?.temperature ?? 0.2,
        providerOptions: { google: { safetySettings: SAFETY_SETTINGS } },
      });
      return result;
    },
    opts?.deadlineAt ?? Date.now() + TOTAL_DEADLINE_MS,
    // One attempt per model, not four. Google meters grounded search
    // separately from and far more tightly than plain generation, so the
    // usual failure here is a quota that will not clear in twenty seconds —
    // eight attempts into that wall just makes the admin wait minutes for
    // the same answer. The second candidate still gets a try, which is what
    // rescues a genuine per-minute rate limit.
    1,
  );

  const sources = ((output.sources ?? []) as Array<{ sourceType?: string; url?: string }>)
    .filter((s) => s.sourceType === "url" && typeof s.url === "string")
    .map((s) => s.url as string);
  return { text: output.text, sources, engine };
}

/**
 * The model-candidate and retry loop every AI call in this pipeline shares.
 *
 * What a failure *means* decides whether we move to the next model. Only a
 * model that is rate-limited or out of quota falls through to the next
 * candidate — that is the one thing the weaker fallback model is there for,
 * since it has its own quota pool. Any other failure (notably a schema miss)
 * throws immediately: retrying it on a weaker model would trade extraction
 * quality away silently, which is exactly what the fallback used to do.
 *
 * `attempt` receives the remaining budget so it can cap its own timeout: no
 * single attempt may outlive the overall deadline.
 *
 * `maxAttempts` is per model, and defaults to the four tries every
 * extraction and explanation call has always had.
 */
async function runWithCandidates<T>(
  attempt: (model: any, remainingMs: number) => Promise<T>,
  deadlineAt: number,
  maxAttempts = 4,
): Promise<{ output: T; engine: ExtractEngine }> {
  const candidates = await getExtractModelCandidates();
  if (!candidates.length) throw new Error("Moteur IA indisponible.");

  const remaining = () => deadlineAt - Date.now();
  let lastError: unknown = new Error("Aucun moteur IA configuré");

  outer: for (const candidate of candidates) {
    // Transient 429/5xx get a real backoff (Google tells us how long to
    // wait), schema misses get an immediate retry.
    for (let attemptNo = 0; attemptNo < maxAttempts; attemptNo++) {
      if (remaining() <= 0) break outer;
      try {
        const out = await attempt(candidate.model, remaining());
        return { output: out, engine: candidate.engine };
      } catch (error) {
        lastError = error;
        if (isTransient(error)) {
          if (attemptNo < maxAttempts - 1 && remaining() > 0) {
            await sleep(Math.min(retryDelayMs(error, attemptNo), Math.max(0, remaining())));
            continue;
          }
          break; // out of patience on this model — the next one has its own quota
        }
        if (NoObjectGeneratedError.isInstance(error) && attemptNo < maxAttempts - 2) continue;
        // Not a quota problem: a weaker model would not do better, and moving
        // to one would hide the failure behind lower-quality output.
        throw friendlyGatewayError(error);
      }
    }
  }

  // Never resolve with an empty list pretending success: the caller must know.
  // Reaching the deadline surfaces as the same friendly message as any other
  // exhausted-retries case — from the admin's side there's no useful
  // difference between "gave up" and "ran out of time to keep trying".
  throw friendlyGatewayError(lastError);
}
