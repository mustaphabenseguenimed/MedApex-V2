import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Direct Google Gemini API access.
 *
 * Requires `GOOGLE_GENERATIVE_AI_API_KEY` to be set (same key already used by
 * the AI-assisted DOCX/image import pipeline).
 */
export function getGeminiProvider() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;
  return createGoogleGenerativeAI({ apiKey });
}

/** Default model for quick text/structured-output tasks (explanations, program extraction, …). */
export const GEMINI_DEFAULT_MODEL = "gemini-3.6-flash";
