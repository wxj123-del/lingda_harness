/** Bounded native-tool discovery; selection is recoverable from request headers and tool results. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'tool-discovery'
/** Required registries and the read-only Session corpus. */
export const inject = ['tools', 'systemPrompt', 'sessionQuery']

/** Per-preset native catalog and discovery budgets. */
export interface Config {
  /** Initial tool count, including pinned tools but excluding tool_search. */
  initialTools: number
  /** Maximum loaded tools, including pinned tools but excluding tool_search. */
  maxTools: number
  /** Always-visible tool names, when registered and allowed in this scope. */
  pinnedTools: string[]
  /** Ordered cold-start preferences for tools without recorded calls. */
  fallbackTools: string[]
  /** Maximum recent other Sessions read once when initializing this agent. */
  historySessions: number
  /** Maximum matching tools loaded by one search. */
  searchLimit: number
  /** Maximum characters of each result's description. */
  descriptionChars: number
  /** Maximum UTF-8 bytes of the complete rendered search result. */
  resultMaxBytes: number
}

/** Explicit deployment budgets; malformed relationships reject at mount. */
export const Config: z<Config> = z.object({
  initialTools: z.number().step(1).min(1).required(),
  maxTools: z.number().step(1).min(1).required(),
  pinnedTools: z.array(z.string()).required(),
  fallbackTools: z.array(z.string()).required(),
  historySessions: z.number().step(1).min(0).required(),
  searchLimit: z.number().step(1).min(1).required(),
  descriptionChars: z.number().step(1).min(0).required(),
  resultMaxBytes: z.number().step(1).min(128).required(),
})

const SEARCH = 'tool_search'

interface Selection {
  loaded: Set<string>
  frequencies: Map<string, number>
  catalog: ToolSchema[]
  cursor: number
  pending: SessionEvent[] | undefined
  ready: Promise<void>
  initialized: boolean
  ownStart: number
  searches: Set<string>
}

function bump(counts: Map<string, number>, tool: string): void {
  if (tool !== SEARCH) counts.set(tool, (counts.get(tool) ?? 0) + 1)
}

function touch(loaded: Set<string>, tool: string): void {
  loaded.delete(tool)
  loaded.add(tool)
}

function trim(selection: Selection, pinned: Set<string>, maxTools: number): void {
  for (const tool of selection.loaded) {
    if (selection.loaded.size <= maxTools) break
    if (!pinned.has(tool)) selection.loaded.delete(tool)
  }
}

function consume(selection: Selection, event: SessionEvent, pinned: Set<string>, maxTools: number): void {
  if (event.seq <= selection.cursor) return
  selection.cursor = event.seq
  if (event.type === 'request/header' && event.data.header.tools?.some(tool => tool.name === SEARCH)) {
    selection.loaded = new Set(event.data.header.tools.filter(tool => tool.name !== SEARCH).map(tool => tool.name))
    selection.initialized = true
  } else if (event.type === 'tool/call') {
    if (event.seq >= selection.ownStart) bump(selection.frequencies, event.data.name)
    if (event.data.name === SEARCH) selection.searches.add(event.data.callId)
    if (selection.loaded.has(event.data.name)) touch(selection.loaded, event.data.name)
  } else if (event.type === 'tool/result' && selection.searches.delete(event.data.message.source.callId) && !event.data.message.content[0].isError) {
    const meta = event.data.meta
    if (meta !== null && typeof meta === 'object' && !Array.isArray(meta) && Array.isArray(meta.toolDiscovery)) {
      for (const tool of meta.toolDiscovery) if (typeof tool === 'string' && tool !== SEARCH) touch(selection.loaded, tool)
    }
  }
  trim(selection, pinned, maxTools)
}

function relevance(tool: ToolSchema, query: string, terms: string[]): number {
  const name = tool.name.toLowerCase()
  if (name === query) return Number.MAX_SAFE_INTEGER
  const words = new Set(name.split(/[^\p{L}\p{N}]+/u))
  const description = tool.description.toLowerCase()
  const scores = terms.map(term => words.has(term) ? 10 : name.includes(term) ? 5 : description.includes(term) ? 1 : 0)
  return scores.includes(0) ? 0 : scores.reduce<number>((sum, score) => sum + score, 0)
}

/**
 * Mount discovery in one preset scope. Hiding schemas never changes execution permissions.
 * @param ctx - scoped plugin context.
 * @param config - validated catalog and result budgets.
 */
export function apply(ctx: Context, config: Config): void {
  if (scopeOf(ctx) === undefined) throw new Error('tool-discovery requires an agent preset scope')
  if (config.initialTools > config.maxTools
    || new Set(config.pinnedTools).size > config.initialTools
    || config.searchLimit > config.maxTools - new Set(config.pinnedTools).size
    || config.pinnedTools.includes(SEARCH) || config.fallbackTools.includes(SEARCH)) {
    throw new Error('tool-discovery: require pinnedTools <= initialTools <= maxTools and searchLimit <= unpinned capacity; tool_search is reserved')
  }
  const pinned = new Set(config.pinnedTools)
  const states = new WeakMap<Session, Selection>()
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() })
  ctx.on('session/event', (session, event) => {
    const selection = states.get(session)
    if (selection === undefined) return
    if (selection.pending !== undefined) selection.pending.push(event)
    else consume(selection, event, pinned, config.maxTools)
  })

  async function prepare(agent: Agent, signal?: AbortSignal): Promise<Selection> {
    const session = agent.session
    const existing = states.get(session)
    if (existing !== undefined) {
      await existing.ready
      signal?.throwIfAborted()
      return existing
    }
    const selection: Selection = {
      loaded: new Set(), frequencies: new Map(), catalog: [], cursor: -1,
      pending: [], ready: Promise.resolve(), initialized: false,
      ownStart: session.inheritedEventCount, searches: new Set(),
    }
    states.set(session, selection)
    const operationSignal = signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal])
    selection.ready = (async () => {
      const query = ctx.sessionQuery
      if (config.historySessions > 0) {
        const records = (await query.listSessions(operationSignal))
          .filter(record => record.header.id !== session.id)
          .sort((a, b) => b.header.createdAt - a.header.createdAt || a.header.id.localeCompare(b.header.id))
          .slice(0, config.historySessions)
        for (const record of records) {
          operationSignal.throwIfAborted()
          let observation
          try {
            observation = await query.observeSession(record.header.id, { signal: operationSignal, projectionMode: 'none' })
          } catch (error: unknown) {
            operationSignal.throwIfAborted()
            ctx.logger.warn(`tool-discovery: cannot read tool usage for ${record.header.id}: ${String(error)}`)
            continue
          }
          try {
            for (const event of observation.events) {
              if (event.seq >= observation.inheritedEventCount && event.type === 'tool/call') bump(selection.frequencies, event.data.name)
            }
          } finally { observation[Symbol.dispose]() }
        }
      }
      const observation = await query.observeSession(session.id, { signal: operationSignal, projectionMode: 'none' })
      try {
        for (const event of observation.events) consume(selection, event, pinned, config.maxTools)
      } finally { observation[Symbol.dispose]() }
      for (const event of selection.pending ?? []) consume(selection, event, pinned, config.maxTools)
      selection.pending = undefined
      operationSignal.throwIfAborted()
    })()
    try { await selection.ready } catch (error: unknown) {
      states.delete(session)
      throw error
    }
    return selection
  }

  function byFrequency(selection: Selection, a: ToolSchema, b: ToolSchema): number {
    const fallback = (tool: string) => {
      const index = config.fallbackTools.indexOf(tool)
      return index === -1 ? config.fallbackTools.length : index
    }
    return (selection.frequencies.get(b.name) ?? 0) - (selection.frequencies.get(a.name) ?? 0)
      || fallback(a.name) - fallback(b.name) || a.name.localeCompare(b.name)
  }

  ctx.tools.register(defineTool({
    name: SEARCH,
    description: 'Find and load tools missing from the current tool list. Use concise English keywords (image, speech, web, workflow, edit) or an exact tool name. Only matching tools are returned; their full parameters become available on the next request. Search only when the task needs a missing capability.',
    parameters: { query: { type: 'string', required: true, description: 'Specific capability or exact tool name; not a request to list every tool.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        loaded: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          name: { type: 'string', required: true }, description: { type: 'string', required: true },
        } } },
        message: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => ({ toolDiscovery: value.loaded.map(tool => tool.name) }),
    },
    async execute(args, exec) {
      const query = args.query.trim().toLowerCase()
      const terms = [...new Set(query.split(/[^\p{L}\p{N}]+/u).filter(Boolean))]
      if (!terms.length || query.length > 160) throw new Error('Use a specific tool name or capability query of 1 to 160 characters.')
      if (exec.agent === undefined) throw new Error('tool_search requires a calling agent')
      const selection = await prepare(exec.agent, exec.signal)
      const allowed = new Set(ctx.tools.schemas(exec.agent).map(tool => tool.name))
      const candidates = selection.catalog.filter(tool => tool.name !== SEARCH && allowed.has(tool.name))
      const exact = candidates.find(tool => tool.name.toLowerCase() === query)
      const matches = (exact === undefined ? candidates : [exact])
        .map(tool => ({ tool, score: relevance(tool, query, terms) }))
        .filter(match => match.score > 0)
        .sort((a, b) => b.score - a.score || byFrequency(selection, a.tool, b.tool))
        .slice(0, config.searchLimit)
      const result = {
        loaded: matches.map(({ tool }) => ({ name: tool.name, description: Array.from(
          new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(tool.description), part => part.segment,
        ).slice(0, config.descriptionChars).join('') })),
        message: matches.length ? 'Loaded tools are available on the next request.' : 'No matching tools. Try a more specific English keyword or exact tool name.',
      }
      while (Buffer.byteLength(JSON.stringify(result)) > config.resultMaxBytes && result.loaded.length) result.loaded.pop()
      if (matches.length && result.loaded.length === 0) throw new Error('Matching tool names exceed the configured search result byte budget.')
      exec.signal.throwIfAborted()
      return result
    },
  }))

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    if (context.agent === undefined) return assembly
    if (!assembly.tools.some(tool => tool.name === SEARCH)) throw new Error('tool-discovery requires native tool presentation with tool_search visible')
    const selection = await prepare(context.agent, context.signal)
    selection.catalog = assembly.tools
    const available = new Set(assembly.tools.map(tool => tool.name))
    for (const tool of selection.loaded) if (!available.has(tool)) selection.loaded.delete(tool)
    for (const tool of pinned) if (available.has(tool)) selection.loaded.add(tool)
    if (!selection.initialized) {
      for (const tool of [...assembly.tools].filter(tool => tool.name !== SEARCH).sort((a, b) => byFrequency(selection, a, b))) {
        if (selection.loaded.size >= config.initialTools) break
        selection.loaded.add(tool.name)
      }
      selection.initialized = true
    }
    trim(selection, pinned, config.maxTools)
    const visible = new Set([...selection.loaded, SEARCH])
    return {
      ...assembly,
      tools: assembly.tools.filter(tool => visible.has(tool.name)),
      sections: assembly.sections.filter(section => !section.name.startsWith('tool:')
        || !available.has(section.name.slice(5)) || visible.has(section.name.slice(5))),
    }
  }, { prepend: true })
}
