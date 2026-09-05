import { getGeminiProvider } from "./ai-provider.server";

/** Which engine produced a set of extracted questions. */
export type ExtractEngine = "gemini" | "local";

export type ModelCandidate = { engine: ExtractEngine; model: any };

/** Built-in (keyless-to-the-client) Gemini models, called directly via GOOGLE_GENERATIVE_AI_API_KEY. */
const BUILTIN_MODEL = "gemini-3.6-flash";
const BUILTIN_QUOTA_FALLBACK_MODEL = "gemini-3.5-flash-lite";

/**
 * Ordered list of model candidates to try (built-in AI only).
 *
 * The second model is a **quota** fallback, not a quality one. It is
 * materially weaker at this extraction task, so `generateWithFallback` only
 * advances to it when the primary is rate-limited or out of quota — never
 * when the primary returned an unusable answer, which would quietly trade
 * quality away where nobody can see it. Its value is having a separate quota
 * pool to fall back on so a large batch can finish.
 */
export async function getExtractModelCandidates(): Promise<ModelCandidate[]> {
  const google = getGeminiProvider();
  if (!google) return [];
  return [
    { engine: "gemini", model: google(BUILTIN_MODEL) },
    { engine: "gemini", model: google(BUILTIN_QUOTA_FALLBACK_MODEL) },
  ];
}
