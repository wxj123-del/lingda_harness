/** Model-facing instructions and JSON-shape guidance for the authoring assistant. */

import type { AuthoringChatTurn, KnowledgeDraft, WorkflowDraft } from './types.ts'

/** Hard ceiling on the assembled user text for one turn. */
export const AUTHORING_MAX_INPUT_BYTES = 128 * 1024

/** Output budget for one generation; drafts are larger than an ordinary reply. */
export const AUTHORING_MAX_OUTPUT_TOKENS = 16_384

/** Ceiling on how many URLs one knowledge turn may fetch. */
export const AUTHORING_MAX_SOURCE_URLS = 8

/** Bytes kept from one fetched page before it reaches the model. */
export const AUTHORING_MAX_SOURCE_CHARS = 12_000

/** Total characters of fetched material admitted to one request. */
export const AUTHORING_MAX_FETCHED_CHARS = 48_000

const WORKFLOW_SHAPE = `{
  "title": string,
  "description": string,
  "steps": string[],
  "nodes": Array<{
    "kind": "start" | "input" | "llm" | "tool" | "knowledge" | "condition" | "code" | "http" | "template" | "output" | "end",
    "title": string,
    "instructions": string,
    "config"?: {
      "model"?: string,
      "tool"?: string,
      "condition"?: string,
      "knowledge"?: string,
      "url"?: string,
      "method"?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD",
      "template"?: string,
      "output"?: string,
      "variable"?: string,
      "format"?: string,
      "language"?: string,
      "retries"?: number
    }
  }>,
  "edges": Array<{ "source": number, "target": number, "sourceHandle"?: "true" | "false" }>
}`

const KNOWLEDGE_SHAPE = `{
  "title": string,
  "description": string,
  "documents": Array<{ "title": string, "content": string, "source"?: string }>
}`

/** System prompt for workflow generation. */
export const WORKFLOW_SYSTEM_PROMPT = `You design visual workflows for Lingda Harness, a local coding agent.
Return exactly one JSON object and no prose, no Markdown fences.

Shape:
${WORKFLOW_SHAPE}

Hard requirements:
- Exactly one node with kind "start" and exactly one with kind "end".
- Every node has a non-empty unique title; "start" has no incoming edges and "end" has no outgoing edges.
- Edges reference nodes by their zero-based index in the "nodes" array. No self edges, no cycles, every non-start node reachable from start, and every non-end node reaches a dead end only through "end".
- A "condition" node may only have outgoing edges in pairs whose "sourceHandle" is "true" and "false".
- A "tool" node requires "config.tool" to name one concrete tool. Never invent a tool name you cannot justify from the user's description; prefer an "llm" node when no specific tool is implied.
- An "http" node requires "config.url" and a valid "config.method".
- Neighbouring stages may be described in "instructions" instead of extra nodes; keep the graph as small as the task allows.
- "steps" is a short ordered summary a person reads on the workflow card, phrased as actions, at most 8 entries.
- Write every human-readable field in the language the user wrote in.

Semantics you must preserve:
- "llm" nodes run a model with the node instruction and the upstream value as input.
- "knowledge" nodes retrieve from a knowledge base; put the library name in "config.knowledge".
- "condition" nodes ask a model a yes/no question written in "config.condition".
- "output" nodes may template the upstream value through "config.output" using {{input}} placeholders.
Do not claim the workflow was saved or executed; you only propose a draft.`

/** System prompt for knowledge-base generation. */
export const KNOWLEDGE_SYSTEM_PROMPT = `You design private knowledge bases for Lingda Harness, a local coding agent.
Return exactly one JSON object and no prose, no Markdown fences.

Shape:
${KNOWLEDGE_SHAPE}

Hard requirements:
- "title" is a short library name; "description" says what questions the library should answer.
- Each document has a non-empty "title" and "content". Content is the actual reference text, not a summary or a placeholder.
- When retrieved source material is supplied, distil it into focused documents and set "source" to the URL it came from.
- When the user supplied material directly, keep their wording; do not invent facts.
- Never fabricate a source URL, statistic, or quotation. Omit a claim you cannot ground in supplied material or well-established public knowledge.
- Prefer several focused documents over one long dump; keep each document under roughly 4000 characters.
- Write every human-readable field in the language the user wrote in.
Do not claim the library was saved or indexed; you only propose a draft.`

/**
 * Render prior turns as a compact transcript the model can refine against.
 * @param history - prior turns, oldest first.
 * @returns the transcript block, or an empty string when there is no history.
 */
export function renderHistory(history: readonly AuthoringChatTurn[] | undefined): string {
  if (history === undefined || history.length === 0) return ''
  const lines = history.slice(-12).map(turn => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text.trim()}`)
  return `Conversation so far:\n${lines.join('\n')}`
}

/**
 * Render the draft a follow-up turn should refine.
 * @param current - the draft being edited.
 * @returns the JSON block, or an empty string when there is no current draft.
 */
export function renderCurrentDraft(current: WorkflowDraft | KnowledgeDraft | undefined): string {
  return current === undefined ? '' : `Current draft to revise:\n${JSON.stringify(current, null, 2)}`
}

/**
 * Assemble the single user message for one turn.
 * @param parts - non-empty sections in render order.
 * @returns the joined message.
 */
export function composeTurn(parts: readonly string[]): string {
  return parts.filter(part => part.trim() !== '').join('\n\n')
}
