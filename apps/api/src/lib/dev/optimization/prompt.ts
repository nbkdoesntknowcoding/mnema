import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';

const log = pino({ name: 'optimization-prompt' });

export interface PromptableFinding {
  rule: string;
  description: string;
  suggestedAction: string;
  taskTitle?: string | null;
}

const STATIC_FALLBACK_TEMPLATE = (f: PromptableFinding): string =>
  `Mnema's optimization analysis flagged the following in your recent work${f.taskTitle ? ` on "${f.taskTitle}"` : ''}:

Finding (${f.rule}): ${f.description}

Recommended change: ${f.suggestedAction}

Adjust your workflow accordingly from your next session onward, and mention in
your completion summary how you incorporated this.`.trim();

/**
 * Turns an optimization finding into a paste-ready instruction an agent can
 * act on. Uses the same pattern as retry/fix-prompt.ts: LLM-generated when
 * ANTHROPIC_API_KEY is set, deterministic template otherwise — the endpoint
 * works on every self-host install either way.
 */
export async function generateOptimizationPrompt(
  finding: PromptableFinding,
): Promise<{ prompt: string; model: string; usedFallback: boolean }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      prompt: STATIC_FALLBACK_TEMPLATE(finding),
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
        content: `You are turning a workflow-optimization finding into an instruction for an AI coding agent.

Finding rule: ${finding.rule}
Finding: ${finding.description}
${finding.taskTitle ? `Related task: "${finding.taskTitle}"` : ''}
Recommended change: ${finding.suggestedAction}

Write a concise instruction (under 200 words) the agent can follow in its next
session. It should:
1. State concretely what behaviour to change and why (tie it to the finding)
2. Give one specific, actionable technique to apply
3. Tell the agent to keep its other working practices unchanged

Write only the instruction, no preamble.`,
      }],
    });

    const content = response.content[0];
    const prompt = content?.type === 'text'
      ? content.text
      : STATIC_FALLBACK_TEMPLATE(finding);

    return { prompt, model: 'claude-haiku-4-5-20251001', usedFallback: false };
  } catch (err) {
    log.warn({ err }, 'Optimization prompt generation failed — using fallback');
    return {
      prompt: STATIC_FALLBACK_TEMPLATE(finding),
      model: 'static-fallback',
      usedFallback: true,
    };
  }
}
