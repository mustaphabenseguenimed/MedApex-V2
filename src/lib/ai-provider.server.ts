import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Direct Google Gemini API access.
 *
 * Replaces the old `createLovableAiGatewayProvider` relay (`ai.gateway.lovable.dev`),
 * which was only reachable — and only had a working API key — inside Lovable's
 * managed Cloud runtime. Now that the project is self-hosted, that relay has no
 * valid key and every call through it fails silently or throws. This talks to
 * Google's API directly instead.
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
