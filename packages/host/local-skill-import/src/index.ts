import { createHash, randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { zipSync } from 'fflate'
import { parseDocument } from 'yaml'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  LocalSkillArchive,
  LocalSkillCandidate,
  LocalSkillIssue,
  LocalSkillRoot,
  LocalSkillScan,
  LocalSkillSource,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    localSkillImport: LocalSkillImportGateway
  }
}

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024
const MAX_FILES = 256
const MAX_SKILL_DOCUMENT_BYTES = 512 * 1024
const ignoredDirectories = new Set(['.git', '.venv', '__MACOSX', '__pycache__', 'node_modules'])

export interface Config {
  /** Codex Skill root; an empty value uses `~/.codex/skills`. */
  codexDirectory: string
  /** Agents Skill root; an empty value uses `~/.agents/skills`. */
  agentsDirectory: string
  /** Maximum directory depth visited below either configured root. */
  maxScanDepth: number
}

interface RootState extends LocalSkillRoot {
  absolutePath: string
  realPath?: string
}

interface FileInventory {
  files: Array<{ absolutePath: string; relativePath: string; size: number }>
  expandedBytes: number
  issue: LocalSkillIssue | null
}

interface CandidateState {
  root: RootState
  directory: string
  candidate: LocalSkillCandidate
}

function displayPath(path: string): string {
  const home = homedir()
  return path === home ? '~' : path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path
}

function portablePath(path: string): string {
  return path.split(sep).join('/')
}

function safeArchivePath(path: string): boolean {
  return path.length <= 512 && !/[\\\x00-\x1f:]/.test(path) && !path.includes('//')
    && !path.startsWith('/') && !path.split('/').some(part => part === '..' || part === '.')
}

function ignoredFile(name: string): boolean {
  return name === '.DS_Store' || name.startsWith('._')
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function metadataOf(text: string): { name: string; description: string; issue: LocalSkillIssue | null } {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text.trimStart())
  if (!match) return { name: '', description: '', issue: 'invalidMetadata' }
  let metadata: unknown
  const header = match[1]
  const body = match[2]
  if (header === undefined || body === undefined)
    return { name: '', description: '', issue: 'invalidMetadata' }
  try {
    const document = parseDocument(header, { uniqueKeys: true })
    if (document.errors.length > 0) return { name: '', description: '', issue: 'invalidMetadata' }
    metadata = document.toJS({ maxAliasCount: 50 })
  } catch {
    return { name: '', description: '', issue: 'invalidMetadata' }
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return { name: '', description: '', issue: 'invalidMetadata' }
  const data = metadata as Record<string, unknown>
  const booleanMetadata = (key: string): boolean => {
    const value = data[key]
    if (value === undefined || typeof value === 'boolean') return true
    if (typeof value === 'number') return value === 0 || value === 1
    return typeof value === 'string' && /^(true|false|yes|no|on|off|0|1)$/i.test(value)
  }
  const valid = typeof data.name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name)
    && typeof data.description === 'string' && data.description.trim() !== ''
    && !['disableModelInvocation', 'modelInvocable', 'userInvocable'].some(key => Object.hasOwn(data, key))
    && booleanMetadata('disable-model-invocation') && booleanMetadata('user-invocable')
  if (!valid) return { name: '', description: '', issue: 'invalidMetadata' }
  if (!body.trim()) return { name: data.name as string, description: (data.description as string).trim(), issue: 'emptyBody' }
  return { name: data.name as string, description: (data.description as string).trim(), issue: null }
}

async function inventory(directory: string): Promise<FileInventory> {
  const files: FileInventory['files'] = []
  let expandedBytes = 0
  let issue: LocalSkillIssue | null = null
  let skillDocuments = 0
  const walk = async (current: string, prefix: string): Promise<void> => {
    if (issue !== null) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      issue = 'unreadable'
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(current, entry.name)
      const relativePath = portablePath(prefix ? join(prefix, entry.name) : entry.name)
      if (!safeArchivePath(relativePath)) {
        issue = 'unsafePath'
        return
      }
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await walk(path, relativePath)
        continue
      }
      if (!entry.isFile() || ignoredFile(entry.name)) continue
      let stats
      try {
        stats = await lstat(path)
      } catch {
        issue = 'unreadable'
        return
      }
      if (!stats.isFile() || stats.isSymbolicLink()) continue
      if (entry.name === 'SKILL.md') skillDocuments += 1
      expandedBytes += stats.size
      files.push({ absolutePath: path, relativePath, size: stats.size })
      if (files.length > MAX_FILES || expandedBytes > MAX_EXPANDED_BYTES) {
        issue = 'tooLarge'
        return
      }
    }
  }
  await walk(directory, '')
  if (skillDocuments !== 1) issue ??= 'multipleSkills'
  return { files, expandedBytes, issue }
}

/** Discover local Codex/Agents Skills and package a selected candidate without executing it. */
export class LocalSkillImportGateway extends TypertRemoteService {
  static Config: schema<Config> = schema.object({
    codexDirectory: schema.string().default(''),
    agentsDirectory: schema.string().default(''),
    maxScanDepth: schema.number().step(1).min(1).max(32).default(16),
  })

  private readonly secret = randomBytes(32)
  private readonly candidates = new Map<string, CandidateState>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'localSkillImport')
  }

  private id(source: LocalSkillSource, relativePath: string): string {
    return createHash('sha256').update(this.secret).update(source).update('\0').update(relativePath).digest('base64url').slice(0, 32)
  }

  private roots(): RootState[] {
    const configured = [
      ['codex', this.config.codexDirectory || join(homedir(), '.codex', 'skills')],
      ['agents', this.config.agentsDirectory || join(homedir(), '.agents', 'skills')],
    ] as const
    return configured.map(([source, path]) => ({
      source,
      path: displayPath(resolve(path)),
      absolutePath: resolve(path),
      available: false,
    }))
  }

  private async inspect(root: RootState, directory: string, relativePath: string): Promise<LocalSkillCandidate> {
    let text = ''
    let metadata = { name: basename(directory), description: '', issue: 'unreadable' as LocalSkillIssue | null }
    try {
      const stats = await lstat(join(directory, 'SKILL.md'))
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_SKILL_DOCUMENT_BYTES)
        metadata.issue = stats.size > MAX_SKILL_DOCUMENT_BYTES ? 'tooLarge' : 'unreadable'
      else {
        text = await readFile(join(directory, 'SKILL.md'), 'utf8')
        metadata = metadataOf(text)
      }
    } catch {
      metadata.issue = 'unreadable'
    }
    const contents = await inventory(directory)
    const issue = metadata.issue ?? contents.issue
    const candidate: LocalSkillCandidate = {
      id: this.id(root.source, relativePath),
      name: metadata.name || basename(directory),
      description: metadata.description,
      source: root.source,
      sourcePath: root.path,
      relativePath,
      fileCount: contents.files.length,
      expandedBytes: contents.expandedBytes,
      issue,
    }
    this.candidates.set(candidate.id, { root, directory, candidate })
    return candidate
  }

  private async scanRoot(root: RootState): Promise<LocalSkillCandidate[]> {
    try {
      root.realPath = await realpath(root.absolutePath)
      root.available = true
    } catch {
      return []
    }
    const found: LocalSkillCandidate[] = []
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > this.config.maxScanDepth) return
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch {
        return
      }
      if (entries.some(entry => entry.name === 'SKILL.md' && entry.isFile())) {
        const relativePath = portablePath(relative(root.absolutePath, directory)) || '.'
        found.push(await this.inspect(root, directory, relativePath))
      }
      await Promise.all(entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !ignoredDirectories.has(entry.name))
        .map(entry => walk(join(directory, entry.name), depth + 1)))
    }
    await walk(root.absolutePath, 0)
    return found
  }

  /**
   * Scan configured roots and read metadata for each discovered `SKILL.md`.
   * @returns Import candidates, root availability, and the scan timestamp.
   */
  @Remote('list')
  async list(): Promise<LocalSkillScan> {
    this.candidates.clear()
    const roots = this.roots()
    const candidates = (await Promise.all(roots.map(root => this.scanRoot(root)))).flat()
      .sort((left, right) => left.name.localeCompare(right.name) || left.relativePath.localeCompare(right.relativePath))
    return {
      candidates,
      roots: roots.map(({ source, path, available }) => ({ source, path, available })),
      scannedAt: Date.now(),
    }
  }

  /**
   * Revalidate and package one candidate returned by the latest scan.
   * @param id - Opaque candidate identifier issued by {@link list}.
   * @returns A base64-encoded ZIP compatible with the Skill marketplace importer.
   */
  @Remote('archive')
  async archive(id: string): Promise<LocalSkillArchive> {
    const selected = this.candidates.get(id)
    if (selected === undefined) throw new Error('Unknown local Skill candidate; scan again')
    const rootPath = await realpath(selected.root.absolutePath)
    const directory = await realpath(selected.directory)
    if (!inside(rootPath, directory)) throw new Error('Local Skill path escaped its configured root')
    const relativePath = selected.candidate.relativePath
    const expectedDirectory = await realpath(join(rootPath, relativePath))
    if (expectedDirectory !== directory) throw new Error('Local Skill candidate changed; scan again')
    if (this.id(selected.root.source, relativePath) !== id) throw new Error('Local Skill candidate changed; scan again')
    const candidate = await this.inspect(selected.root, directory, relativePath)
    if (candidate.issue !== null) throw new Error(`Local Skill cannot be imported: ${candidate.issue}`)
    const contents = await inventory(directory)
    if (contents.issue !== null) throw new Error(`Local Skill cannot be imported: ${contents.issue}`)
    const files: Record<string, Uint8Array> = {}
    for (const file of contents.files) {
      const stats = await lstat(file.absolutePath)
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== file.size)
        throw new Error('Local Skill changed while being imported; scan again')
      files[file.relativePath] = new Uint8Array(await readFile(file.absolutePath))
    }
    const archive = zipSync(files, { level: 6 })
    if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Local Skill archive exceeds the 2 MB limit')
    return { archive: Buffer.from(archive).toString('base64') }
  }
}

export default LocalSkillImportGateway
