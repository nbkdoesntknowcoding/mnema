import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';

const log = pino({ name: 'fix-prompt' });

const STATIC_FALLBACK_TEMPLATE = (blocker: string, taskTitle: string): string =>
  `You previously attempted to complete the task "${taskTitle}" but encountered a blocker:

"${blocker}"

Please analyse what went wrong and try a different approach. Consider:
1. Breaking the problem into smaller steps
2. Reading relevant files before making changes
3. Checking for existing patterns in the codebase that solve similar problems

Proceed with the task.`.trim();

export async function generateFixPrompt(
  taskTitle: string,
  taskDescription: string | null,
  blockerDescription: string,
  previousRetryCount: number,
): Promise<{ prompt: string; model: string; usedFallback: boolean }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      prompt: STATIC_FALLBACK_TEMPLATE(blockerDescription, taskTitle),
      model: 'static-fallback',
      usedFallback: true,
    };
  }

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `You are helping an AI coding agent recover from a failed task attempt.

Task: "${taskTitle}"
${taskDescription ? `Description: ${taskDescription}` : ''}
Previous blocker (attempt ${previousRetryCount}): "${blockerDescription}"

Write a concise recovery instruction (under 200 words) for the agent.
The instruction should:
1. Acknowledge what failed
2. Suggest a specific alternative approach
3. Tell the agent to proceed

Write only the instruction, no preamble.`,
      }],
    });

    const content = response.content[0];
    const prompt = content?.type === 'text'
      ? content.text
      : STATIC_FALLBACK_TEMPLATE(blockerDescription, taskTitle);

    return { prompt, model: 'claude-haiku-4-5-20251001', usedFallback: false };
  } catch (err) {
    log.warn({ err }, 'Fix prompt generation failed — using fallback');
    return {
      prompt: STATIC_FALLBACK_TEMPLATE(blockerDescription, taskTitle),
      model: 'static-fallback',
      usedFallback: true,
    };
  }
}
