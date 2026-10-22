import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepCompactionSidecars } from '../src/sidecar-cleanup.ts'

const SESSION_DIR = `session-${'a'.repeat(16)}`
const DAY = 24 * 60 * 60 * 1000

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sidecar-sweep-'))
  const directory = join(root, SESSION_DIR)
  await mkdir(directory, { recursive: true })
  return root
}

/** Write one file with an explicit age in days. */
async function aged(path: string, days: number): Promise<void> {
  await writeFile(path, 'x')
  const when = new Date(Date.now() - days * DAY)
  await utimes(path, when, when)
}

describe('compaction sidecar sweep', () => {
  it('removes stale summary files and prunes the emptied session directory', async () => {
    const root = await fixture()
    try {
      const directory = join(root, SESSION_DIR)
      await aged(join(directory, 'old.md'), 40)
      const removed = await sweepCompactionSidecars(root, 30, () => {})
      expect(removed).toBe(1)
      expect(await readdir(root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps a fresh summary and its directory', async () => {
    const root = await fixture()
    try {
      const directory = join(root, SESSION_DIR)
      await aged(join(directory, 'fresh.md'), 1)
      const removed = await sweepCompactionSidecars(root, 30, () => {})
      expect(removed).toBe(0)
      expect(await readdir(directory)).toEqual(['fresh.md'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ignores entries that do not match the package file shape', async () => {
    const root = await fixture()
    try {
      const directory = join(root, SESSION_DIR)
      await aged(join(directory, 'notes.txt'), 90)
      await aged(join(directory, 'keep.log'), 90)
      await writeFile(join(root, 'shared.txt'), 'x')
      const removed = await sweepCompactionSidecars(root, 30, () => {})
      expect(removed).toBe(0)
      expect((await readdir(directory)).sort()).toEqual(['keep.log', 'notes.txt'])
      expect(await readdir(root)).toContain('shared.txt')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ignores a directory that does not match the session shape', async () => {
    const root = await fixture()
    try {
      const other = join(root, 'session-backup')
      await mkdir(other, { recursive: true })
      await aged(join(other, 'old.md'), 90)
      const removed = await sweepCompactionSidecars(root, 30, () => {})
      expect(removed).toBe(0)
      expect(await readdir(other)).toEqual(['old.md'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('is a no-op when retention is disabled', async () => {
    const root = await fixture()
    try {
      const directory = join(root, SESSION_DIR)
      await aged(join(directory, 'old.md'), 400)
      expect(await sweepCompactionSidecars(root, 0, () => {})).toBe(0)
      expect(await readdir(directory)).toEqual(['old.md'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports a missing root without throwing', async () => {
    const warnings: string[] = []
    const removed = await sweepCompactionSidecars(join(tmpdir(), 'definitely-missing-sidecar-root'), 30, (message) => {
      warnings.push(message)
    })
    expect(removed).toBe(0)
    expect(warnings).toEqual([])
  })
})
