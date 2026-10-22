/**
 * Re-readable compaction sidecar: the exact summary text of one compaction,
 * written under a private per-session directory so a later compaction folding
 * that summary into a coarser one does not destroy the detail.
 * @module @deepseek-ai/dsh-compaction-basic/sidecar
 */

import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

/** Everything one sidecar file records. */
export interface SidecarInput {
  sessionId: SessionId
  compactionId: string
  turn: number | null
  /** Inclusive surface-node span the summary replaced. */
  shadowedRange: { start: SessionSeq; end: SessionSeq }
  /** The summary blocks exactly as the checkpoint carries them. */
  summary: readonly ContentBlock[]
}

/** Per-session directory name: a stable hash keeps a long or exotic id out of the path. */
function sessionDirectory(sessionId: SessionId): string {
  return `session-${createHash('sha256').update(sessionId).digest('hex').slice(0, 16)}`
}

/** Concatenated text of the summary's text blocks. */
function summaryText(summary: readonly ContentBlock[]): string {
  return summary
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n\n')
}

/**
 * Write one summary sidecar and return its absolute path.
 * @param root - deployment root, or the default private per-process directory.
 * @param input - the compaction record to write.
 * @returns the sidecar path; throws when the file cannot be written.
 */
export function writeCompactionSidecar(
  root: string | undefined,
  input: SidecarInput,
): string {
  const base = root ?? join(tmpdir(), `dsh-compaction-${createHash('sha256').update(homedir()).digest('hex').slice(0, 8)}`)
  const directory = join(base, sessionDirectory(input.sessionId))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const path = join(directory, `${input.compactionId}.md`)
  const header = [
    '---',
    `compaction: ${input.compactionId}`,
    `turn: ${input.turn === null ? 'standalone' : String(input.turn)}`,
    `shadowed: ${String(input.shadowedRange.start)}..${String(input.shadowedRange.end)}`,
    `written: ${new Date().toISOString()}`,
    '---',
    '',
  ].join('\n')
  writeFileSync(path, `${header}${summaryText(input.summary)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}
