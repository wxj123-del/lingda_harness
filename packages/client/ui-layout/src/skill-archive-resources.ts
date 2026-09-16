/** Materialize imported resources locally without executing archive content. */
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { decodeSkillArchive, readSkillArchive } from './skill-archive.ts'

/**
 * @param archive - Stored ZIP; validated again before any filesystem writes.
 * @param home - Harness home containing the private imported resource cache.
 * @returns Absolute Skill directory, stable for identical archive content.
 */
export async function materializeSkillArchive(archive: string, home: string): Promise<string> {
  const bytes = decodeSkillArchive(archive)
  const skill = readSkillArchive(bytes)
  const root = join(home, 'skill-imports')
  const directory = join(root, createHash('sha256').update(bytes).digest('hex'))
  try {
    const existing = await lstat(directory)
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Skill resource path is not a directory')
    return directory
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(root, { recursive: true, mode: 0o700 })
  const temporary = await mkdtemp(join(root, '.import-'))
  try {
    for (const [path, content] of Object.entries(skill.files)) {
      const target = join(temporary, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content, { flag: 'wx', mode: 0o600 })
    }
    try { await rename(temporary, directory) } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error
      const existing = await lstat(directory)
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw error
    }
    return directory
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
