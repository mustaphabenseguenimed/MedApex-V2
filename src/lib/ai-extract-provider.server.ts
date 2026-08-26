import { getClaudeProvider } from "./ai-provider.server";

/** Which engine produced a set of extracted questions. */
export type ExtractEngine = "claude" | "local";

export type ModelCandidate = { engine: ExtractEngine; model: any };

/** Built-in (keyless-to-the-client) Claude models, called directly via ANTHROPIC_API_KEY. */
const BUILTIN_MODEL = "claude-sonnet-5";
const BUILTIN_FALLBACK_MODEL = "claude-haiku-4-5";

/** Ordered list of model candidates to try (built-in AI only). */
export async function getExtractModelCandidates(): Promise<ModelCandidate[]> {
  const anthropic = getClaudeProvider();
  if (!anthropic) return [];
  return [
    { engine: "claude", model: anthropic(BUILTIN_MODEL) },
    { engine: "claude", model: anthropic(BUILTIN_FALLBACK_MODEL) },
  ];
}
