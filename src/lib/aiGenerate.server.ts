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
 */
const TOTAL_DEADLINE_MS = 240_000;

/** Shared model + retry loop, used by every structured AI call in the
 *  conversion pipeline so the retry policy lives in one place.
 *
 *  What a failure *means* decides whether we move to the next model. Only a
 *  model that is rate-limited or out of quota falls through to the next
 *  candidate — that is the one thing the weaker fallback model is there for,
 *  since it has its own quota pool. Any other failure (notably a schema miss)
 *  throws immediately: retrying it on a weaker model would trade extraction
 *  quality away silently, which is exactly what the fallback used to do. */
export async function generateWithFallback<T>(
  schema: z.ZodType<T>,
  content: AiContent,
  opts?: { temperature?: number; timeoutMs?: number; thinking?: boolean },
): Promise<{ output: T; engine: ExtractEngine }> {
  const candidates = await getExtractModelCandidates();
  if (!candidates.length) throw new Error("Moteur IA indisponible.");

  const startedAt = Date.now();
  const remaining = () => TOTAL_DEADLINE_MS - (Date.now() - startedAt);

  const attempt = async (model: any) => {
    const { output } = await generateText({
      model,
      output: Output.object({ schema }),
      // Never let a single attempt outlive the overall budget, even if the
      // caller asked for a longer per-attempt timeout.
      abortSignal: AbortSignal.timeout(
        Math.max(1000, Math.min(opts?.timeoutMs ?? 150_000, remaining())),
      ),
      messages: [{ role: "user", content: content as any }],
      temperature: opts?.temperature ?? 0.2,
      providerOptions: {
        google: {
          safetySettings: SAFETY_SETTINGS,
          ...(opts?.thinking ? { thinkingConfig: { thinkingLevel: "high" } } : {}),
        },
      },
    });
    return output;
  };

  let lastError: unknown = new Error("Aucun moteur IA configuré");

  outer: for (const candidate of candidates) {
    // Up to 4 tries per model: transient 429/5xx get a real backoff (Google
    // tells us how long to wait), schema misses get an immediate retry.
    for (let attemptNo = 0; attemptNo < 4; attemptNo++) {
      if (remaining() <= 0) break outer;
      try {
        const out = await attempt(candidate.model);
        return { output: out, engine: candidate.engine };
      } catch (error) {
        lastError = error;
        if (isTransient(error)) {
          if (attemptNo < 3 && remaining() > 0) {
            await sleep(Math.min(retryDelayMs(error, attemptNo), Math.max(0, remaining())));
            continue;
          }
          break; // out of patience on this model — the next one has its own quota
        }
        if (NoObjectGeneratedError.isInstance(error) && attemptNo < 2) continue;
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
