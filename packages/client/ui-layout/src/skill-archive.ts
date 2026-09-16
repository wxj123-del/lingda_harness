/** Bounded ZIP import shared by the browser preview and Host resource loader. */
import { strFromU8, unzipSync } from 'fflate'
import { parseDocument } from 'yaml'
import { SKILL_CATEGORIES, type SkillCategory } from './authoring-settings.ts'

/** Import format bounds apply before decompression on both sides. */
export const MAX_SKILL_ARCHIVE_BYTES = 2 * 1024 * 1024
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024
const MAX_FILES = 256

export type SkillArchiveErrorCode = 'invalidZip' | 'tooLarge' | 'unsafePath' | 'missingSkill' | 'multipleSkills' | 'invalidMetadata' | 'emptyBody'

/** Structured import failure translated by the presentation owner. */
export class SkillArchiveError extends Error {
  constructor(readonly code: SkillArchiveErrorCode) { super(code) }
}

/** Validated archive contents relative to its single Skill directory. */
export interface ImportedSkill {
  name: string
  description: string
  body: string
  category: SkillCategory
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  files: Record<string, Uint8Array>
}

function ignored(path: string): boolean {
  return path.split('/').some(part => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._'))
}

function safePath(path: string): boolean {
  return path.length <= 512 && !/[\\\x00-\x1f:]/.test(path) && !path.includes('//')
    && !path.startsWith('/') && !path.split('/').some(part => part === '..' || part === '.')
}

function booleanField(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key]
  if (value === undefined) return fallback
  if (value === true || value === 1 || /^(true|yes|on|1)$/i.test(String(value))) return true
  if (value === false || value === 0 || /^(false|no|off|0)$/i.test(String(value))) return false
  throw new SkillArchiveError('invalidMetadata')
}

/** @param bytes - ZIP bytes selected by a user. @returns Validated instructions and retained bundle files. */
export function readSkillArchive(bytes: Uint8Array): ImportedSkill {
  if (bytes.length > MAX_SKILL_ARCHIVE_BYTES) throw new SkillArchiveError('tooLarge')
  let total = 0
  let count = 0
  const paths = new Set<string>()
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, { filter: (entry) => {
      if (++count > MAX_FILES) throw new SkillArchiveError('tooLarge')
      if (!safePath(entry.name)) throw new SkillArchiveError('unsafePath')
      const canonical = entry.name.toLocaleLowerCase()
      if (paths.has(canonical)) throw new SkillArchiveError('unsafePath')
      paths.add(canonical)
      total += entry.originalSize
      if (total > MAX_EXPANDED_BYTES) throw new SkillArchiveError('tooLarge')
      return !entry.name.endsWith('/') && !ignored(entry.name)
    } })
  } catch (error) {
    throw error instanceof SkillArchiveError ? error : new SkillArchiveError('invalidZip')
  }
  const skills = Object.keys(entries).filter(path => path.split('/').at(-1) === 'SKILL.md')
  if (skills.length === 0) throw new SkillArchiveError('missingSkill')
  if (skills.length !== 1) throw new SkillArchiveError('multipleSkills')
  const path = skills[0]!
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(entries[path]) } catch { throw new SkillArchiveError('invalidMetadata') }
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text.trimStart())
  if (!match) throw new SkillArchiveError('invalidMetadata')
  let metadata: unknown
  try {
    const document = parseDocument(match[1]!, { uniqueKeys: true })
    if (document.errors.length > 0) throw new Error('Invalid YAML')
    metadata = document.toJS({ maxAliasCount: 50 })
  } catch { throw new SkillArchiveError('invalidMetadata') }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new SkillArchiveError('invalidMetadata')
  const data = metadata as Record<string, unknown>
  if (typeof data.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name)
    || typeof data.description !== 'string' || !data.description.trim()
    || ['disableModelInvocation', 'modelInvocable', 'userInvocable'].some(key => Object.hasOwn(data, key))) throw new SkillArchiveError('invalidMetadata')
  const body = match[2]!.trim()
  if (!body) throw new SkillArchiveError('emptyBody')
  const category = data.category ?? (data.metadata as Record<string, unknown> | undefined)?.category
  const root = path.slice(0, -'SKILL.md'.length)
  const files = Object.fromEntries(Object.entries(entries).filter(([name]) => name.startsWith(root)).map(([name, content]) => [name.slice(root.length), content]))
  return {
    name: data.name, description: data.description.trim(), body,
    category: SKILL_CATEGORIES.some(value => value === category) ? category as SkillCategory : 'general',
    invocation: { modelInvocable: !booleanField(data, 'disable-model-invocation', false), userInvocable: booleanField(data, 'user-invocable', true) },
    files,
  }
}

/** @param bytes - Validated ZIP bytes. @returns Portable settings representation. */
export function encodeSkillArchive(bytes: Uint8Array): string { return btoa(strFromU8(bytes, true)) }

/** @param archive - Stored ZIP. @returns Bytes for validation and extraction. */
export function decodeSkillArchive(archive: string): Uint8Array {
  if (archive.length > Math.ceil(MAX_SKILL_ARCHIVE_BYTES / 3) * 4) throw new SkillArchiveError('tooLarge')
  try { return Uint8Array.from(atob(archive), char => char.charCodeAt(0)) } catch { throw new SkillArchiveError('invalidZip') }
}
