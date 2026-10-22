/**
 * Best-effort retention sweep for compaction sidecars. One startup pass removes
 * summary files older than the configured age, then prunes session directories
 * that became empty. Anything not matching this package's own file shape is
 * left untouched, so a configured root can be shared.
 * @module @deepseek-ai/dsh-compaction-basic/sidecar-cleanup
 */

import { lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** A compaction summary file: `<compactionId>.md`. */
const SIDE_CAR_FILE_RE = /^[A-Za-z0-9._-]+\.md$/

/** A per-session directory: `session-<16 lowercase hex>`. */
const SESSION_DIR_RE = /^session-[0-9a-f]{16}$/

/** Warning sink; cleanup never throws. */
export type WarnFn = (message: string) => void

function warnSafely(warn: WarnFn, message: string): void {
  try {
    warn(message)
  } catch {
    // Cleanup is observational; a throwing logger must not break startup.
  }
}

/** Whether an error means the entry vanished between listing and inspection. */
function isGone(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { code?: unknown }).code === 'ENOENT'
}

/** Files eligible for removal, by modification time. */
async function staleFiles(directory: string, cutoff: number): Promise<string[]> {
  const stale: string[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !SIDE_CAR_FILE_RE.test(entry.name)) continue
    const path = join(directory, entry.name)
    try {
      const info = await lstat(path)
      if (info.mtimeMs < cutoff) stale.push(path)
    } catch (error: unknown) {
      if (!isGone(error)) throw error
    }
  }
  return stale
}

/**
 * Remove sidecar files older than `retentionDays` and any session directory left
 * empty. `retentionDays <= 0` disables the sweep.
 * @param root - the sidecar root to sweep, when one is configured.
 * @param retentionDays - age in days past which a summary file is removed.
 * @param warn - receives one message per failed entry; never rethrown.
 * @returns how many files were removed.
 */
export async function sweepCompactionSidecars(
  root: string,
  retentionDays: number,
  warn: WarnFn,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  let removed = 0

  let sessions: string[]
  try {
    const entries = await readdir(root, { withFileTypes: true })
    sessions = entries
      .filter(entry => entry.isDirectory() && SESSION_DIR_RE.test(entry.name))
      .map(entry => join(root, entry.name))
  } catch (error: unknown) {
    if (!isGone(error)) warnSafely(warn, `compaction sidecar sweep: cannot read ${root}: ${String(error)}`)
    return 0
  }

  for (const directory of sessions) {
    try {
      for (const path of await staleFiles(directory, cutoff)) {
        try {
          await unlink(path)
          removed += 1
        } catch (error: unknown) {
          if (!isGone(error)) warnSafely(warn, `compaction sidecar sweep: cannot remove ${path}: ${String(error)}`)
        }
      }
      // rmdir succeeds only when the directory is empty, so a session still
      // holding fresh summaries keeps its directory.
      await rmdir(directory).catch((error: unknown) => {
        if (!isGone(error)) return
      })
    } catch (error: unknown) {
      warnSafely(warn, `compaction sidecar sweep: ${directory}: ${String(error)}`)
    }
  }

  return removed
}
