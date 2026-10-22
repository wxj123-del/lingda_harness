/** Structural validation and repair for model-produced authoring drafts. */

import type {
  AuthoringNodeKind,
  DraftKnowledgeDocument,
  DraftWorkflowEdge,
  DraftWorkflowNode,
  KnowledgeDraft,
  WorkflowDraft,
} from './types.ts'
import { AUTHORING_NODE_KINDS } from './types.ts'

/** Why one model draft could not be accepted. */
export class DraftRejected extends Error {
  /** @param message - operator-facing reason. */
  constructor(message: string) {
    super(message)
    this.name = 'DraftRejected'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new DraftRejected(`${field} must be a non-empty string`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new DraftRejected(`${field} exceeds ${String(max)} characters`)
  return trimmed
}

function optionalString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed.slice(0, max)
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])

function nodeConfig(value: unknown): DraftWorkflowNode['config'] {
  if (!isRecord(value)) return undefined
  const config: NonNullable<DraftWorkflowNode['config']> = {}
  const model = optionalString(value.model, 200)
  const tool = optionalString(value.tool, 200)
  const condition = optionalString(value.condition, 4000)
  const output = optionalString(value.output, 4000)
  const variable = optionalString(value.variable, 200)
  const knowledge = optionalString(value.knowledge, 200)
  const format = optionalString(value.format, 40)
  const language = optionalString(value.language, 40)
  const url = optionalString(value.url, 2000)
  const template = optionalString(value.template, 4000)
  const method = optionalString(value.method, 10)?.toUpperCase()
  if (model !== undefined) config.model = model
  if (tool !== undefined) config.tool = tool
  if (condition !== undefined) config.condition = condition
  if (output !== undefined) config.output = output
  if (variable !== undefined) config.variable = variable
  if (knowledge !== undefined) config.knowledge = knowledge
  if (format !== undefined) config.format = format
  if (language !== undefined) config.language = language
  if (url !== undefined) config.url = url
  if (template !== undefined) config.template = template
  if (method !== undefined && HTTP_METHODS.has(method)) config.method = method
  if (typeof value.retries === 'number' && Number.isSafeInteger(value.retries)) {
    config.retries = Math.max(0, Math.min(5, value.retries))
  }
  return Object.keys(config).length === 0 ? undefined : config
}

function nodeKind(value: unknown): AuthoringNodeKind {
  if (typeof value !== 'string' || !(AUTHORING_NODE_KINDS as readonly string[]).includes(value)) {
    throw new DraftRejected(`node kind must be one of ${AUTHORING_NODE_KINDS.join(', ')}`)
  }
  return value as AuthoringNodeKind
}

/** Largest draft the visual editor accepts. */
const MAX_NODES = 40
const MAX_EDGES = 80

/**
 * Validate one model-produced workflow draft and drop edges that do not
 * survive validation, so a partially wrong proposal stays usable.
 * @param value - parsed JSON value from the model.
 * @returns the accepted draft.
 */
export function acceptWorkflowDraft(value: unknown): WorkflowDraft {
  if (!isRecord(value)) throw new DraftRejected('workflow draft must be a JSON object')
  const title = requiredString(value.title, 'title', 200)
  const description = requiredString(value.description, 'description', 4000)
  if (!Array.isArray(value.nodes) || value.nodes.length < 2) throw new DraftRejected('workflow needs at least a start and an end node')
  if (value.nodes.length > MAX_NODES) throw new DraftRejected(`workflow exceeds ${String(MAX_NODES)} nodes`)
  if (!Array.isArray(value.edges)) throw new DraftRejected('edges must be an array')

  const nodes: DraftWorkflowNode[] = value.nodes.map((entry, index) => {
    if (!isRecord(entry)) throw new DraftRejected(`node ${String(index)} must be an object`)
    const kind = nodeKind(entry.kind)
    const node: DraftWorkflowNode = {
      kind,
      title: requiredString(entry.title, `nodes[${String(index)}].title`, 200),
      instructions: optionalString(entry.instructions, 8000) ?? '',
    }
    const config = nodeConfig(entry.config)
    if (config !== undefined) node.config = config
    if (kind === 'tool' && config?.tool === undefined) throw new DraftRejected(`nodes[${String(index)}] is a tool node without config.tool`)
    if (kind === 'http' && (config?.url === undefined || config.method === undefined)) {
      throw new DraftRejected(`nodes[${String(index)}] is an http node without config.url and config.method`)
    }
    return node
  })
  const starts = nodes.filter(node => node.kind === 'start').length
  const ends = nodes.filter(node => node.kind === 'end').length
  if (starts !== 1) throw new DraftRejected('workflow needs exactly one start node')
  if (ends !== 1) throw new DraftRejected('workflow needs exactly one end node')

  const edges: DraftWorkflowEdge[] = []
  for (const entry of value.edges) {
    if (!isRecord(entry)) continue
    const source = entry.source
    const target = entry.target
    if (typeof source !== 'number' || typeof target !== 'number') continue
    if (!Number.isInteger(source) || !Number.isInteger(target)) continue
    if (source === target) continue
    if (source < 0 || target < 0 || source >= nodes.length || target >= nodes.length) continue
    if (edges.some(edge => edge.source === source && edge.target === target)) continue
    const sourceHandle = entry.sourceHandle === 'true' || entry.sourceHandle === 'false' ? entry.sourceHandle : undefined
    edges.push({ source, target, ...(sourceHandle === undefined ? {} : { sourceHandle }) })
    if (edges.length > MAX_EDGES) break
  }

  const steps = Array.isArray(value.steps)
    ? value.steps
      .filter((step): step is string => typeof step === 'string' && step.trim() !== '')
      .slice(0, 12)
      .map(step => step.trim().slice(0, 400))
    : []

  return { title, description, steps, nodes, edges }
}

/**
 * Validate one model-produced knowledge draft.
 * @param value - parsed JSON value from the model.
 * @returns the accepted draft.
 */
export function acceptKnowledgeDraft(value: unknown): KnowledgeDraft {
  if (!isRecord(value)) throw new DraftRejected('knowledge draft must be a JSON object')
  const title = requiredString(value.title, 'title', 200)
  const description = optionalString(value.description, 4000) ?? ''
  if (!Array.isArray(value.documents) || value.documents.length === 0) {
    throw new DraftRejected('knowledge draft needs at least one document')
  }
  const documents: DraftKnowledgeDocument[] = value.documents.slice(0, 200).map((entry, index) => {
    if (!isRecord(entry)) throw new DraftRejected(`documents[${String(index)}] must be an object`)
    const source = optionalString(entry.source, 2000)
    return {
      title: requiredString(entry.title, `documents[${String(index)}].title`, 300),
      content: requiredString(entry.content, `documents[${String(index)}].content`, 200_000),
      ...(source === undefined ? {} : { source }),
    }
  })
  return { title, description, documents }
}

/**
 * Extract the first balanced JSON object from model output that may carry
 * fences or surrounding prose.
 * @param text - raw model text.
 * @returns parsed JSON.
 */
export function parseDraftJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const body = (fenced?.[1] ?? text).trim()
  const start = body.indexOf('{')
  if (start === -1) throw new DraftRejected('model reply carried no JSON object')
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < body.length; index += 1) {
    const char = body[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, index + 1))
        } catch (cause) {
          throw new DraftRejected(`model JSON could not be parsed: ${cause instanceof Error ? cause.message : String(cause)}`)
        }
      }
    }
  }
  throw new DraftRejected('model JSON object is unterminated')
}

/**
 * Keep the prose part of a model reply for the chat transcript.
 * @param text - raw model text.
 * @returns the reply without a trailing JSON block.
 */
export function replyText(text: string): string {
  const start = text.indexOf('{')
  const prose = start === -1 ? text : text.slice(0, start)
  return prose.replace(/```(?:json)?/gi, '').trim().slice(0, 4000)
}
