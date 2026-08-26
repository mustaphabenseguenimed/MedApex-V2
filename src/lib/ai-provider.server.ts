import { createAnthropic } from "@ai-sdk/anthropic";

/**
 * Direct Anthropic Claude API access.
 *
 * Requires `ANTHROPIC_API_KEY` to be set (same key already used by
 * the AI-assisted DOCX/image import pipeline).
 */
export function getClaudeProvider() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return createAnthropic({ apiKey });
}

/** Default model for quick text/structured-output tasks (explanations, program extraction, …). */
export const CLAUDE_DEFAULT_MODEL = "claude-sonnet-5";
