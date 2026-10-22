import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatHeader, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import {
  assertReleasedV4Header,
  releasedV4SessionFormatCodec,
  restoreReleasedV4Artifact,
  sessionFormatV3ToV4,
} from '../src/index.ts'

const v3Header: SessionFormatHeader = {
  version: 3, id: 'v3-session', createdAt: 1, isSeeded: false, delegationDepth: 0,
}

function userEvent(source: SessionFormatJsonObject = { kind: 'user' }): SessionFormatEvent {
  return {
    type: 'user/message', seq: 2, time: 3, surfaceOp: 'append',
    data: {
      id: 'message-1', role: 'user', source,
      content: [{ type: 'text', text: 'hello' }],
    },
  }
}

function decode(rows: readonly Record<string, unknown>[], header: SessionFormatHeader) {
  const target = header.version === 4 ? header : sessionFormatV3ToV4.migrateHeader(header)
  const decoder = releasedV4SessionFormatCodec.createDecoder(
    releasedV4SessionFormatCodec.encodeHeader(target, 0), 'strict',
  )
  const collector = new SessionFormatEventCollector()
  for (const row of rows) decoder.decodeRow(row, collector)
  return { header: decoder.header, inheritedEventCount: decoder.finish(collector), events: collector.values }
}

describe('released V3 to V4 identity edge', () => {
  it('changes only the header version and preserves a V3 event stream', () => {
    const target = sessionFormatV3ToV4.migrateHeader(v3Header)
    expect(target).toEqual({ ...v3Header, version: 4 })
    const stage = sessionFormatV3ToV4.createStage({
      sourceHeader: v3Header,
      targetHeader: target,
      sourceInheritedEventCount: 0,
      sourceKind: 'decoded',
    })
    const collector = new SessionFormatEventCollector()
    const event = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } satisfies SessionFormatEvent
    stage.transformEvent(event, collector)
    expect(stage.finish(collector)).toBe(0)
    expect(collector.values).toEqual([event])
  })

  it('preserves Feishu message sources through physical V4 round trips', () => {
    const source = { kind: 'feishu', source: 'primary', eventId: 'evt-1', form: 'notice', summary: 'hello' }
    const event = userEvent(source)
    const encoded = releasedV4SessionFormatCodec.encodeEvent(event)
    expect(encoded.data).toEqual(event.data)
    const decoded = decode([
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
      encoded,
    ], v3Header)
    expect(decoded.events.at(-1)).toEqual(event)
    const artifact = {
      header: { ...v3Header, version: 4 },
      inheritedEventCount: 0,
      events: decoded.events,
    }
    expect(restoreReleasedV4Artifact(artifact, new Set())).toBe(artifact)
  })

  it('accepts the workflow schedule payload introduced after V3', () => {
    const event: SessionFormatEvent = {
      type: 'schedule/change', seq: 0, time: 1,
      data: { version: 2, operation: 'delete', id: 'schedule-1' },
    }
    const artifact = {
      header: { ...v3Header, version: 4 },
      inheritedEventCount: 0,
      events: [event],
    }
    expect(restoreReleasedV4Artifact(artifact, new Set(['schedule/change']))).toBe(artifact)
  })

  it('derives and validates a seeded inherited cut', () => {
    const sourceHeader = { ...v3Header, isSeeded: true, parentSession: 'parent' }
    const targetHeader = sessionFormatV3ToV4.migrateHeader(sourceHeader)
    const stage = sessionFormatV3ToV4.createStage({
      sourceHeader, targetHeader, sourceInheritedEventCount: undefined, sourceKind: 'decoded',
    })
    const collector = new SessionFormatEventCollector()
    stage.transformEvent({ type: 'session/end-seed', seq: 0, time: 1, data: { inherited: true } }, collector)
    expect(stage.finish(collector)).toBe(0)
  })

  it('refuses malformed or newer headers', () => {
    expect(() =>{  assertReleasedV4Header({ ...v3Header, version: 3 }) }).toThrow(/format v4/)
    expect(() => releasedV4SessionFormatCodec.decodeHeader({ ...v3Header, version: 5 })).toThrow(/format v4 physical/)
  })
})
