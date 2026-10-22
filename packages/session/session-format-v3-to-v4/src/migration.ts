/** Identity migration that releases the unchanged V3 logical language as V4. */

import { SessionFormatError, defineSessionFormatMigration, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatEvent,
  SessionFormatEventRun,
  SessionFormatMigrationContext,
  SessionFormatMigrationStage,
  SessionFormatMigrationStageInput,
} from '@deepseek-ai/dsh-session-format'
import { assertReleasedV3Header } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { assertReleasedV4Header } from './validation.ts'

/** Promote a released V3 header and preserve every admitted logical event. */
export const sessionFormatV3ToV4 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v3-to-v4',
  fromVersion: 3,
  toVersion: 4,
  migrateHeader(header) {
    assertReleasedV3Header(header)
    return { ...header, version: 4 }
  },
  createStage(input) {
    return new ReleasedV3ToV4Stage(input)
  },
  validateTargetHeader: assertReleasedV4Header,
})

class ReleasedV3ToV4Stage implements SessionFormatMigrationStage {
  readonly headerInheritedEventCount?: number
  private readonly seeded: boolean
  private sourceSeq = 0
  private inheritedCut: number | undefined

  constructor(private readonly input: SessionFormatMigrationStageInput) {
    assertReleasedV3Header(input.sourceHeader)
    assertReleasedV4Header(input.targetHeader)
    this.seeded = input.sourceHeader.isSeeded
    if (!this.seeded) this.headerInheritedEventCount = 0
    if (input.sourceInheritedEventCount !== undefined) {
      sessionFormatCount(input.sourceInheritedEventCount, 'format v3 inherited event count')
    }
  }

  transformEvent(event: SessionFormatEvent, context: SessionFormatMigrationContext): void {
    if (event.seq !== this.sourceSeq) throw new SessionFormatError('format v3 source events must be dense')
    this.sourceSeq += 1
    if (event.type === 'session/end-seed' && isInheritedMarker(event)) {
      if (!this.seeded) throw new SessionFormatError('format v3 unseeded Session contains an inherited end-seed marker')
      this.inheritedCut = event.seq
    }
    context.emitEvent(event)
  }

  transformRun(run: SessionFormatEventRun, context: SessionFormatMigrationContext): void {
    for (const event of run.expand()) this.transformEvent(event, context)
  }

  finish(_context: SessionFormatMigrationContext): number {
    const cut = this.seeded
      ? sessionFormatCount(this.inheritedCut, 'format v3 seeded Session inherited event count')
      : 0
    if (!this.seeded && this.inheritedCut !== undefined) {
      throw new SessionFormatError('format v3 unseeded Session contains an inherited end-seed marker')
    }
    if (this.input.sourceInheritedEventCount !== undefined && this.input.sourceInheritedEventCount !== cut) {
      throw new SessionFormatError('format v3 inherited end-seed marker disagrees with its source cut')
    }
    return cut
  }
}

function isInheritedMarker(event: SessionFormatEvent): boolean {
  return typeof event.data === 'object'
    && event.data !== null
    && !Array.isArray(event.data)
    && (event.data as { readonly inherited?: unknown })['inherited'] === true
}
