import { getGeminiProvider } from "./ai-provider.server";

/** Which engine produced a set of extracted questions. */
export type ExtractEngine = "gemini" | "local";

export type ModelCandidate = { engine: ExtractEngine; model: any };

/** Built-in (keyless-to-the-client) Gemini model, called directly via GOOGLE_GENERATIVE_AI_API_KEY. */
const BUILTIN_MODEL = "gemini-3.6-flash";

/**
 * Ordered list of model candidates to try (built-in AI only).
 *
 * Deliberately a single model. There used to be a `gemini-3.5-flash-lite`
 * fallback, but it is materially weaker at this extraction task: falling back
 * to it turned a loud failure into a quiet drop in quality that nobody could
 * see in the output. `generateWithFallback` retries this model harder instead,
 * and a chunk that still fails now fails visibly so the admin can re-run it.
 */
export async function getExtractModelCandidates(): Promise<ModelCandidate[]> {
  const google = getGeminiProvider();
  if (!google) return [];
  return [{ engine: "gemini", model: google(BUILTIN_MODEL) }];
}
