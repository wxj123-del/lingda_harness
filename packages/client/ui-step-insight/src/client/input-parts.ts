/** Historical request inputs reconstructed from recorded surface operations. */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deriveEventMessage, isSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { InputPart, StepRow } from './types.ts'
import { contentText, estimateText, hasMedia } from './usage.ts'

function sourceOf(event: SessionEvent): string {
  if (event.type === 'tool/result') return event.data.message.content.map(block => block.toolCallId).join(', ')
  if (event.type !== 'user/message') return ''
  const source = event.data.source
  return JSON.stringify(source)
}

/**
 * Recover the loaded request prefix, applying replacements before counting it.
 * @param entries - contiguous loaded events, including transient chunks.
 * @param row - attempt whose input precedes inputBeforeSeq.
 * @param hasMore - older source events have not been loaded.
 * @returns Inspectable heuristic input parts and explicit reconstruction gaps.
 */
export function inspectInput(entries: readonly SessionEventLikeEntry[], row: StepRow, hasMore: boolean): {
  parts: InputPart[]
  incomplete: boolean
  unsupported: boolean
} {
  const surface: InputPart[] = []
  let schemas: InputPart[] = []
  let incomplete = hasMore
  let unsupported = false
  for (const entry of entries) {
    const event = entry.event
    if (event.seq >= row.inputBeforeSeq) break
    if (event.type === 'assistant/live-chunk') continue
    if (event.type === 'request/header') {
      schemas = (event.data.header.tools ?? []).map((tool) => {
        const text = JSON.stringify(tool, null, 2)
        return { id: `schema:${tool.name}`, seq: event.seq, kind: 'schema', source: tool.name,
          text, tokens: estimateText(JSON.stringify(tool)), media: false,
          schema: { name: tool.name, description: tool.description } }
      })
    }
    if (!isSurfaceEvent(event)) continue
    const message = deriveEventMessage(event)
    const text = message === null ? '' : contentText(message.content)
    const source = sourceOf(event)
    const kind: InputPart['kind'] = message === null ? 'unknown'
      : message.role === 'system' ? 'system'
        : message.role === 'assistant' ? 'assistant'
          : event.type === 'tool/result' ? 'tool'
            : event.type === 'user/message' && event.data.source.kind !== 'user' ? 'context' : 'user'
    if (message === null && event.type !== 'system/message' && event.type !== 'assistant/message') unsupported = true
    const part: InputPart = { id: `event:${event.seq}`, seq: event.seq, kind, source, text,
      tokens: estimateText(text), media: message !== null && hasMedia(message.content),
      ...(kind === 'user' && message !== null ? {
        userText: message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
      } : {}) }
    if (event.surfaceOp === 'append') surface.push(part)
    else {
      const { startSeq, endSeq } = event.surfaceOp
      const start = surface.findIndex(item => item.seq === startSeq)
      const end = surface.findIndex(item => item.seq === endSeq)
      if (start < 0 || end < start) {
        incomplete = true
        const index = surface.findIndex(item => item.seq >= startSeq)
        if (index >= 0) surface.splice(index, surface.filter(item => item.seq >= startSeq && item.seq <= endSeq).length, part)
        else surface.push(part)
      } else surface.splice(start, end - start + 1, part)
    }
  }
  // Compaction prompts are backend-owned and are not logged as ordinary headers.
  if (row.kind === 'compaction') return { parts: [], incomplete: true, unsupported: false }
  return { parts: [...surface.filter(part => part.text.length > 0), ...schemas], incomplete, unsupported }
}
