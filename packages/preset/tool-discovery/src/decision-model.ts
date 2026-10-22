import type { ToolSchema } from '@deepseek-ai/dsh-llm'

/** Configuration for an optional local typed-decision model endpoint. */
export interface DecisionModelOptions {
  /** Endpoint implementing the decider service's `POST /decide` contract. */
  readonly url: string
  /** Abort one decision request after this many milliseconds. */
  readonly timeoutMs: number
  /** Ignore a model choice below this confidence and use lexical fallback. */
  readonly minConfidence: number
  /** Maximum candidate tools sent to the decision model. */
  readonly candidateLimit: number
}

interface DecisionAnswer {
  readonly choice?: unknown
  readonly confidence?: unknown
  readonly probabilities?: unknown
}

/** A model-ranked tool candidate with its calibrated confidence. */
export interface DecisionToolCandidate {
  readonly tool: ToolSchema
  readonly confidence: number
}

function endpoint(url: string): string {
  return url.endsWith('/') ? `${url}decide` : `${url}/decide`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function answerOf(value: unknown): DecisionAnswer | undefined {
  if (!isRecord(value)) return undefined
  const answer = value.capability
  return isRecord(answer) ? answer : undefined
}

function probabilitiesOf(value: unknown, candidates: readonly ToolSchema[]): Map<string, number> {
  if (!isRecord(value)) return new Map()
  const probabilities = new Map<string, number>()
  for (const candidate of candidates) {
    const score = value[candidate.name]
    if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1) probabilities.set(candidate.name, score)
  }
  return probabilities
}

function signalFor(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}

/**
 * Ask a typed-decision endpoint to rank candidate tools.
 *
 * Network, schema, and response errors are deliberately converted to
 * `undefined`: tool discovery must keep its deterministic fallback and must
 * never turn an unavailable advisory model into a tool failure.
 *
 * @param query - The model-produced capability query.
 * @param candidates - Already permission-filtered tool candidates.
 * @param options - Endpoint and bounded decision settings.
 * @param signal - Caller-owned cancellation signal.
 * @returns Ranked candidates, or `undefined` when the advisory decision is unavailable.
 */
export async function decideToolCandidates(
  query: string,
  candidates: readonly ToolSchema[],
  options: DecisionModelOptions,
  signal: AbortSignal,
): Promise<DecisionToolCandidate[] | undefined> {
  if (candidates.length === 0) return []
  const bounded = candidates.slice(0, options.candidateLimit)
  const requestSignal = signalFor(signal, options.timeoutMs)
  try {
    const response = await fetch(endpoint(options.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: query,
        schema: {
          capability: {
            type: 'choice',
            instructions: [
              'Which available tool best matches the requested capability?',
              ...bounded.map(tool => `- ${tool.name}: ${tool.description.slice(0, 256)}`),
            ].join('\n'),
            options: bounded.map(tool => tool.name),
          },
        },
      }),
      signal: requestSignal,
    })
    if (!response.ok) return undefined
    const payload: unknown = await response.json()
    const answer = answerOf(payload)
    if (answer === undefined || typeof answer.choice !== 'string') return undefined
    const chosen = bounded.find(tool => tool.name === answer.choice)
    if (chosen === undefined) return undefined
    const confidence = typeof answer.confidence === 'number' && Number.isFinite(answer.confidence)
      ? Math.min(1, Math.max(0, answer.confidence))
      : 0
    if (confidence < options.minConfidence) return undefined
    const probabilities = probabilitiesOf(answer.probabilities, bounded)
    probabilities.set(chosen.name, Math.max(probabilities.get(chosen.name) ?? 0, confidence))
    return bounded
      .map(tool => ({ tool, confidence: probabilities.get(tool.name) ?? 0 }))
      .filter(candidate => candidate.confidence > 0)
      .sort((left, right) => right.confidence - left.confidence || left.tool.name.localeCompare(right.tool.name))
  } catch (error: unknown) {
    if (signal.aborted) throw error
    return undefined
  }
}
