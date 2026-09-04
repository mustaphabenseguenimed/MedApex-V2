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

/** Shared model + retry loop: tries each configured model in turn, retrying
 *  transient (429/5xx) errors with backoff and a schema miss twice, before
 *  moving to the next candidate. Used by every structured AI call in the
 *  conversion pipeline so the retry policy lives in one place. */
export async function generateWithFallback<T>(
  schema: z.ZodType<T>,
  content: AiContent,
  opts?: { temperature?: number; timeoutMs?: number; thinking?: boolean },
): Promise<{ output: T; engine: ExtractEngine }> {
  const candidates = await getExtractModelCandidates();
  if (!candidates.length) throw new Error("Moteur IA indisponible.");

  const attempt = async (model: any) => {
    const { output } = await generateText({
      model,
      output: Output.object({ schema }),
      abortSignal: AbortSignal.timeout(opts?.timeoutMs ?? 150_000),
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

  for (const candidate of candidates) {
    // Up to 4 tries per model: transient 429/5xx get a real backoff (Google
    // tells us how long to wait), schema misses get an immediate retry.
    // Worth being persistent — there is deliberately no weaker fallback model
    // to drop down to, so giving up here fails the chunk outright.
    for (let attemptNo = 0; attemptNo < 4; attemptNo++) {
      try {
        const out = await attempt(candidate.model);
        return { output: out, engine: candidate.engine };
      } catch (error) {
        lastError = error;
        if (isTransient(error)) {
          if (attemptNo < 3) {
            await sleep(retryDelayMs(error, attemptNo));
            continue;
          }
          break;
        }
        if (NoObjectGeneratedError.isInstance(error) && attemptNo < 2) continue;
        break; // terminal for this model — try the next candidate
      }
    }
  }

  // Never resolve with an empty list pretending success: the caller must know.
  throw friendlyGatewayError(lastError);
}
