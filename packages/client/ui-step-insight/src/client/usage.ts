/** Provider accounting and explicitly heuristic content sizes. */
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { Usage } from './types.ts'

function count(value: number | undefined): number | null {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * Normalize provider counters without treating omitted cache fields as zero.
 * @param value - usage from one attempt, never combined with another attempt.
 * @returns Disjoint counters and an exact total only when supported by the evidence.
 */
export function readUsage(value?: TokenUsage): Usage {
  const input = count(value?.inputTokens)
  const output = count(value?.outputTokens)
  const cacheRead = count(value?.cacheReadTokens)
  const cacheWrite = count(value?.cacheWriteTokens)
  const reasoning = count(value?.reasoningTokens)
  const knownPrompt = (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
  const reportedTotal = count(value?.totalTokens)
  let total: number | null = null
  if (input !== null && output !== null) {
    if (reportedTotal !== null && reportedTotal >= knownPrompt + output
      && (cacheRead === null || cacheWrite === null || reportedTotal === knownPrompt + output)) {
      total = reportedTotal
    } else if (reportedTotal === null && cacheRead !== null && cacheWrite !== null
      && Number.isSafeInteger(knownPrompt + output)) {
      total = knownPrompt + output
    }
  }
  const prompt = total === null || output === null ? null : total - output
  return {
    input, output, cacheRead, cacheWrite,
    reasoning: reasoning !== null && output !== null && reasoning <= output ? reasoning : null,
    prompt, total,
    unclassified: prompt === null ? null : prompt - knownPrompt,
    minimumPrompt: input === null && cacheRead === null && cacheWrite === null ? null : knownPrompt,
    minimumTotal: input === null && output === null && cacheRead === null && cacheWrite === null ? null : knownPrompt + (output ?? 0),
  }
}

/**
 * Estimate visible text size; this is not a provider tokenizer or billing count.
 * @param text - original text, including JSON when inspecting a schema.
 * @returns A fixed four-characters-per-token approximation.
 */
export function estimateText(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Render inspectable content while retaining tool arguments and result structure.
 * @param blocks - recorded content in provider order.
 * @returns Plain source text suitable for React's escaped text rendering.
 */
export function contentText(blocks: readonly ContentBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'text' || block.type === 'reasoning') return block.text
    if (block.type === 'tool-call') return `${block.name}\n${block.arguments}`
    if (block.type === 'tool-result') return contentText(block.content)
    return JSON.stringify(block, null, 2)
  }).join('\n')
}

/**
 * Identify media whose provider token price cannot be recovered from text length.
 * @param blocks - model-visible content.
 * @returns Whether a block or nested tool result contains nontext content.
 */
export function hasMedia(blocks: readonly ContentBlock[]): boolean {
  return blocks.some(block => block.type === 'tool-result' ? hasMedia(block.content)
    : !['text', 'reasoning', 'tool-call'].includes(block.type))
}
