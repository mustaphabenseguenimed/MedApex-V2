import { getGeminiProvider } from "./ai-provider.server";

/** Which engine produced a set of extracted questions. */
export type ExtractEngine = "gemini" | "local";

export type ModelCandidate = { engine: ExtractEngine; model: any };

/** Built-in (keyless-to-the-client) Gemini models, called directly via GOOGLE_GENERATIVE_AI_API_KEY. */
const BUILTIN_MODEL = "gemini-3.6-flash";
const BUILTIN_FALLBACK_MODEL = "gemini-3.5-flash-lite";

/** Ordered list of model candidates to try (built-in AI only). */
export async function getExtractModelCandidates(): Promise<ModelCandidate[]> {
  const google = getGeminiProvider();
  if (!google) return [];
  return [
    { engine: "gemini", model: google(BUILTIN_MODEL) },
    { engine: "gemini", model: google(BUILTIN_FALLBACK_MODEL) },
  ];
}
