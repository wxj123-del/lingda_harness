/** V4 physical codec: the released V3 framing with a versioned header boundary. */

import { SessionFormatError, isSessionFormatJsonObject, snapshotSessionFormatJson } from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatCodec,
  SessionFormatCurrentEncoder,
  SessionFormatEvent,
  SessionFormatHeader,
} from '@deepseek-ai/dsh-session-format'
import { releasedV2SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { assertV3Event, assertV3EventAdmission, assertV3StructuralRow } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { v3CompatibleEvent } from './compatibility.ts'
import { assertReleasedV4Header } from './validation.ts'

/** V4 preserves the V3 row layout and event encoding exactly. */
export const releasedV4SessionFormatCodec = Object.freeze({
  version: 4,
  decodeHeader(value) {
    return { ...releasedV2SessionFormatCodec.decodeHeader(v2PhysicalHeader(value)), version: 4 }
  },
  createDecoder(value, recovery) {
    const decoder = releasedV2SessionFormatCodec.createDecoder(v2PhysicalHeader(value), recovery)
    let issue: SessionFormatError | undefined
    let acceptedInheritedCut: number | undefined
    return {
      header: { ...decoder.header, version: 4 },
      ...(decoder.header.isSeeded ? {} : { headerInheritedEventCount: 0 }),
      decodeRow(row, context) {
        assertV4RowAdmission(row)
        decoder.decodeRow(row, {
          emitRun: context.emitRun.bind(context),
          emitEvent(event) {
            assertV3EventAdmission(event)
            if (issue === undefined) {
              try {
                assertV3Event(v3CompatibleEvent(event))
              } catch (error: unknown) {
                const invalid = error as SessionFormatError
                if (recovery === 'strict') throw invalid
                issue = invalid
              }
            }
            if (issue !== undefined) {
              if (event.type === 'turn/end') throw issue
              return
            }
            if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data)
              && event.data['inherited'] === true) acceptedInheritedCut = event.seq
            context.emitEvent(event)
          },
        })
      },
      finish(context) {
        if (issue === undefined) return decoder.finish(context)
        if (decoder.header.isSeeded && acceptedInheritedCut === undefined) {
          throw new SessionFormatError('format v4 seeded Session lacks an accepted inherited end-seed marker')
        }
        if (!decoder.header.isSeeded && acceptedInheritedCut !== undefined) {
          throw new SessionFormatError('format v4 unseeded Session contains an inherited end-seed marker')
        }
        return acceptedInheritedCut ?? 0
      },
    }
  },
  encodeHeader(header, inheritedEventCount) {
    assertReleasedV4Header(header)
    return {
      ...releasedV2SessionFormatCodec.encodeHeader({ ...header, version: 2 }, inheritedEventCount),
      version: 4,
    }
  },
  encodeEvent(event) {
    assertV3EventAdmission(event)
    assertV3Event(v3CompatibleEvent(event))
    return releasedV2SessionFormatCodec.encodeEvent(event)
  },
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder)

function v2PhysicalHeader(value: unknown): SessionFormatHeader {
  const header = snapshotSessionFormatJson(value, 'format v4 physical header')
  if (!isSessionFormatJsonObject(header) || header['version'] !== 4) {
    throw new SessionFormatError('expected format v4 physical Session header')
  }
  return { ...header, version: 2 } as SessionFormatHeader
}

function assertV4RowAdmission(row: unknown): void {
  assertV3StructuralRow(row)
  if (typeof row === 'object' && row !== null && !Array.isArray(row)) {
    assertV3EventAdmission(row as SessionFormatEvent)
  }
}
