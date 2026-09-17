/** Read-only usage aggregation over the same live-preferred corpus as Session search. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tools/types'
import type { ToolUsageSnapshot } from './types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/**
 * Count recorded calls without loading cold Sessions into the live store.
 * @param query - authoritative live and persisted Session reader.
 * @param signal - cancellation for corpus reads.
 * @returns Call and request-exposure counts, observed schemas, and incomplete-record counts.
 */
export async function readToolUsage(query: Context['sessionQuery'], signal: AbortSignal): Promise<ToolUsageSnapshot> {
  const records = await query.listSessions(signal)
  const stats = new Map<string, {
    directCalls: number
    internalCalls: number
    exposedRequests: number
    usedRequests: number
    sessions: number
    lastUsedAt: number | null
  }>()
  const definitions = new Map<string, { time: number; description: string; parameters: JsonValue }>()
  let failedSessionCount = 0
  let requestCount = 0
  let unknownCatalogRequests = 0
  for (const record of records) {
    signal.throwIfAborted()
    let observation
    try {
      observation = await query.observeSession(record.header.id, { signal, projectionMode: 'none' })
    } catch (_error) {
      signal.throwIfAborted()
      // A missing or unreadable saved Session makes the aggregate explicitly partial.
      failedSessionCount += 1
      continue
    }
    try {
      const seenInternal = new Set<string>()
      const used = new Set<string>()
      let catalog: Set<string> | undefined
      // A settled response owns its calls even if the catalog changes before dispatch.
      const pendingCalls = new Map<string, { name: string; hits: Set<string> }>()
      const ensure = (name: string) => {
        let value = stats.get(name)
        if (value === undefined) {
          value = { directCalls: 0, internalCalls: 0, exposedRequests: 0, usedRequests: 0, sessions: 0, lastUsedAt: null }
          stats.set(name, value)
        }
        return value
      }
      for (const [index, event] of observation.events.entries()) {
        if (event.type === 'request/header') {
          // Headers are change snapshots, not one event per request. Forks inherit this state.
          catalog = new Set((event.data.header.tools ?? []).map(tool => tool.name))
          for (const tool of event.data.header.tools ?? []) {
            ensure(tool.name)
            const previous = definitions.get(tool.name)
            if (previous === undefined || event.time > previous.time) {
              // Session readers have already decoded the header as durable JSON.
              definitions.set(tool.name, { time: event.time, description: tool.description, parameters: tool.parameters as JsonValue })
            }
          }
        }
        if (index >= observation.inheritedEventCount
          && (event.type === 'assistant/message' || event.type === 'assistant/attempt')) {
          requestCount += 1
          if (catalog === undefined) unknownCatalogRequests += 1
          else {
            for (const name of catalog) ensure(name).exposedRequests += 1
            if (event.type === 'assistant/message') {
              const hits = new Set<string>()
              for (const block of event.data.message.content) {
                if (block.type === 'tool-call' && catalog.has(block.name)) {
                  pendingCalls.set(`${event.data.turn}:${event.data.step}:${block.id}`, { name: block.name, hits })
                }
              }
            }
          }
        }
        const internal = event.type === 'tool/ptc-dispatch-start' || event.type === 'tool/ptc-dispatch'
        if (event.type !== 'tool/call' && !internal) continue
        if (internal) {
          if (seenInternal.has(event.data.subCallId)) continue
          seenInternal.add(event.data.subCallId)
        }
        // Fork prefixes repeat executions already owned by the parent Session.
        if (index < observation.inheritedEventCount) continue
        const value = ensure(event.data.name)
        if (internal) value.internalCalls += 1
        else {
          value.directCalls += 1
          const key = `${event.data.turn}:${event.data.step}:${event.data.callId}`
          const owner = pendingCalls.get(key)
          pendingCalls.delete(key)
          if (owner?.name === event.data.name && !owner.hits.has(event.data.name)) {
            owner.hits.add(event.data.name)
            value.usedRequests += 1
          }
        }
        value.lastUsedAt = Math.max(value.lastUsedAt ?? event.time, event.time)
        used.add(event.data.name)
      }
      for (const name of used) {
        const value = stats.get(name)
        if (value !== undefined) value.sessions += 1
      }
    } finally {
      observation[Symbol.dispose]()
    }
  }
  return {
    tools: [...stats].map(([name, value]) => {
      const definition = definitions.get(name)
      return { name, ...value, calls: value.directCalls + value.internalCalls,
        ...(definition === undefined ? {} : { description: definition.description, parameters: definition.parameters }) }
    })
      .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
    sessionCount: records.length - failedSessionCount,
    requestCount,
    unknownCatalogRequests,
    failedSessionCount,
    scannedAt: Date.now(),
  }
}
