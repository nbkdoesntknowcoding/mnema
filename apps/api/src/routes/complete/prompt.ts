/**
 * Gemini prompt for inline autocomplete.
 *
 * Kept short on purpose — the 6 rules cover the cases without diluting
 * the signal. Don't add fluff or examples. Long prompts mean more input
 * tokens (cost) and can dampen the model's continuation quality.
 *
 * The user prompt uses canonical Fill-In-the-Middle (FIM) bracketing.
 * Gemini Flash-Lite handles the FIM shape well without explicit markers
 * like `<|fim_prefix|>` — XML-ish tags are enough.
 */

export const SYSTEM_PROMPT = `You are an inline autocomplete assistant for a Notion-style markdown editor.
Given the prefix (text before the cursor) and suffix (text after the cursor), predict the most likely continuation at the cursor position.

Rules:
- Output ONLY the continuation text, no explanations.
- Match the surrounding style: same tense, same person, same level of formality.
- Continue the current sentence or list item; do not start a new section.
- Generate 5-30 words. Stop at a sentence boundary or natural pause.
- If the prefix ends mid-word, complete the word first.
- If you don't have enough context to predict, output an empty string.`;

export function buildUserPrompt(prefix: string, suffix: string): string {
  return `<prefix>\n${prefix}\n</prefix>\n<suffix>\n${suffix}\n</suffix>\nContinuation:`;
}
