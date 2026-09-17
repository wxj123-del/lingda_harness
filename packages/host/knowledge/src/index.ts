import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { connect, type Connection } from '@lancedb/lancedb'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { LocalEmbedding } from './embedding.ts'
import { splitDocuments, splitSchema } from './split.ts'
import { knowledgeTools } from './tools.ts'
import type {
  IndexStatus,
  KnowledgeBase,
  KnowledgeBaseDraft,
  KnowledgeBaseId,
  KnowledgeChunk,
  KnowledgeDocumentId,
  KnowledgeHit,
  KnowledgeOverview,
  KnowledgeSearch,
  LegacyKnowledgeBase,
  SplitOptions,
} from './types.ts'

export type * from './types.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledge: KnowledgeGateway
  }
}
export interface Config {
  dataDirectory: string
  model: string
  queryPrefix: string
  batchSize: number
  maxDocumentChars: number
  maxLibraryChars: number
  maxChunks: number
  defaultChunkSize: number
  defaultChunkOverlap: number
  searchLimit: number
}
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const documentSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(300),
  content: z.string(),
  updatedAt: z.number(),
})
const draftSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(300),
  description: z.string().max(4000),
  enabled: z.boolean(),
  split: splitSchema,
  documents: z.array(documentSchema).max(1000),
  revision: z.number().int().nonnegative(),
})
const hitSchema = z.object({
  documentId: idSchema,
  title: z.string(),
  ordinal: z.number().int().nonnegative(),
  content: z.string(),
  _distance: z.number(),
})
const storedSchema = z.object({
  version: z.literal(1),
  migrated: z.boolean(),
  bases: z.array(draftSchema.extend({ updatedAt: z.number() })),
  indexes: z.record(
    z.string(),
    z.object({ table: z.string(), revision: z.number(), model: z.string(), chunks: z.number() }),
  ),
})
type Manifest = z.infer<typeof storedSchema>
const idleIndex = (status: IndexStatus['status'] = 'pending'): IndexStatus => ({
  status,
  chunks: 0,
  completed: 0,
  total: 0,
  error: null,
})

/** Local libraries and vector search shared by the authoring UI and agent tools. */
export class KnowledgeGateway extends TypertRemoteService {
  static inject = ['settings']
  static Config: schema<Config> = schema.object({
    dataDirectory: schema.string().default(''),
    model: schema.string().default('Xenova/bge-small-zh-v1.5'),
    queryPrefix: schema.string().default('为这个句子生成表示以用于检索相关文章：'),
    batchSize: schema.number().step(1).min(1).max(64).default(8),
    maxDocumentChars: schema.number().step(1).min(1).default(250_000),
    maxLibraryChars: schema.number().step(1).min(1).default(2_000_000),
    maxChunks: schema.number().step(1).min(1).default(20_000),
    defaultChunkSize: schema.number().step(1).min(64).max(400).default(400),
    defaultChunkOverlap: schema.number().step(1).min(0).max(200).default(60),
    searchLimit: schema.number().step(1).min(1).max(20).default(6),
  })
  private readonly directory: string
  private readonly embedding: LocalEmbedding
  private readonly defaults: SplitOptions
  private db!: Connection
  private manifest: Manifest = { version: 1, migrated: false, bases: [], indexes: {} }
  private readonly statuses = new Map<string, IndexStatus>()
  private readonly jobs = new Map<string, Promise<void>>()
  private readonly lifetime = new AbortController()
  private writes: Promise<unknown> = Promise.resolve()
  private refreshTools: (() => void) | undefined
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx, 'knowledge')
    const settingsPath = ctx.get('settings')?.documentPath
    if (config.dataDirectory) this.directory = resolve(config.dataDirectory)
    else if (settingsPath !== undefined) this.directory = join(dirname(settingsPath), 'knowledge')
    else
      throw new Error('knowledge.dataDirectory is required without file settings')
    this.defaults = splitSchema.parse({
      mode: 'recursive',
      size: config.defaultChunkSize,
      overlap: config.defaultChunkOverlap,
    })
    this.embedding = new LocalEmbedding(
      config.model,
      join(this.directory, 'models'),
      config.queryPrefix,
    )
  }
  async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    await mkdir(this.directory, { recursive: true })
    try {
      this.manifest = storedSchema.parse(
        JSON.parse(await readFile(join(this.directory, 'libraries.json'), 'utf8')),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    this.db = await connect(join(this.directory, 'vectors'))
    yield async () => {
      this.lifetime.abort()
      await Promise.allSettled([...this.jobs.values()])
      await this.writes
      await this.embedding.dispose()
      this.db.close()
    }
    for (const base of this.manifest.bases) {
      const index = this.manifest.indexes[base.id]
      const ready =
        index?.revision === base.revision &&
        index.model === this.modelKey() &&
        (index.chunks === 0 || (await this.tableExists(index.table)))
      this.statuses.set(
        base.id,
        ready
          ? { ...idleIndex('ready'), chunks: index.chunks }
          : idleIndex(base.documents.length ? 'pending' : 'empty'),
      )
    }
    this.ctx.inject(['tools'], (toolCtx) => {
      let disposers: (() => void)[] = []
      const sync = () => {
        const enabled = this.manifest.bases.some(base => base.enabled)
        if (enabled === disposers.length > 0) return
        if (enabled) disposers = knowledgeTools(this).map(tool => toolCtx.tools.register(tool))
        else {
          for (const dispose of disposers) dispose()
          disposers = []
        }
      }
      toolCtx.effect(() => {
        this.refreshTools = sync
        sync()
        return () => {
          this.refreshTools = undefined
          for (const dispose of disposers) dispose()
        }
      })
    })
  }
  @Remote('overview')
  overview(): Promise<KnowledgeOverview> {
    return Promise.resolve({
      bases: this.manifest.bases.map(({ documents, ...base }) => ({
        ...base,
        id: base.id as KnowledgeBaseId,
        documentCount: documents.length,
        index: { ...this.requireStatus(base.id) },
      })),
      model: { ...this.embedding.state },
      defaults: this.defaults,
    })
  }
  @Remote('get')
  get(id: KnowledgeBaseId): Promise<KnowledgeBase> {
    return Promise.resolve(structuredClone(this.requireBase(id)))
  }
  @Remote('save')
  async save(draft: KnowledgeBaseDraft): Promise<KnowledgeBase> {
    const parsed = draftSchema.parse(draft)
    this.validateDocuments(parsed.documents)
    const result = await this.mutate((next) => {
      const previous = next.bases.find(base => base.id === parsed.id)
      if ((previous?.revision ?? 0) !== parsed.revision)
        throw new Error('Knowledge base changed; reload before saving')
      const base = { ...parsed, revision: parsed.revision + 1, updatedAt: Date.now() }
      next.bases = [...next.bases.filter(item => item.id !== parsed.id), base]
      return base as KnowledgeBase
    })
    this.statuses.set(result.id, idleIndex(result.documents.length ? 'pending' : 'empty'))
    this.schedule(result.id)
    return structuredClone(result)
  }
  @Remote('deleteBase')
  async deleteBase(id: KnowledgeBaseId, revision: number): Promise<void> {
    const previous = this.manifest.indexes[id]
    await this.mutate((next) => {
      if (this.requireBase(id).revision !== revision)
        throw new Error('Knowledge base changed; reload before deleting')
      next.bases = next.bases.filter(base => base.id !== id)
      Reflect.deleteProperty(next.indexes, id)
    })
    this.statuses.delete(id)
    if (previous && (await this.tableExists(previous.table)))
      await this.db.dropTable(previous.table)
  }
  @Remote('reindex')
  reindex(id: KnowledgeBaseId): Promise<IndexStatus> {
    this.requireBase(id)
    if (!this.jobs.has(id)) {
      this.statuses.set(id, idleIndex())
      this.schedule(id)
    }
    return Promise.resolve({ ...this.requireStatus(id) })
  }
  @Remote('preview')
  async preview(
    documents: KnowledgeBase['documents'],
    options: SplitOptions,
  ): Promise<KnowledgeChunk[]> {
    this.validateDocuments(z.array(documentSchema).max(1000).parse(documents))
    const chunks = await splitDocuments(documents, options)
    if (chunks.length > this.config.maxChunks)
      throw new Error('Too many chunks; increase chunk size or reduce documents')
    return chunks
  }
  @Remote('importLegacy')
  async importLegacy(legacy: LegacyKnowledgeBase[]): Promise<number> {
    if (this.manifest.migrated) return 0
    const count = await this.mutate((next) => {
      if (next.migrated) return 0
      let count = 0
      for (const item of legacy) {
        if (next.bases.some(base => base.id === item.id)) continue
        const documents = item.documents?.length
          ? item.documents
          : item.body.trim()
            ? [{ id: randomUUID(), title: item.title, content: item.body, updatedAt: Date.now() }]
            : []
        const base = draftSchema.parse({
          ...item,
          title: item.title || item.id,
          split: this.defaults,
          documents,
          revision: 0,
        })
        this.validateDocuments(base.documents)
        next.bases.push({ ...base, revision: 1, updatedAt: Date.now() })
        count++
      }
      next.migrated = true
      return count
    })
    for (const base of this.manifest.bases) {
      if (!this.statuses.has(base.id))
        this.statuses.set(base.id, idleIndex(base.documents.length ? 'pending' : 'empty'))
    }
    return count
  }
  @Remote('search')
  async search(query: string, baseId: string, signal: AbortSignal): Promise<KnowledgeSearch> {
    z.string().trim().min(1).max(2000).parse(query)
    signal.throwIfAborted()
    const candidates = this.manifest.bases.filter(
      base => base.enabled && (!baseId || base.id === baseId),
    )
    const skippedBases = candidates
      .filter(base => this.statuses.get(base.id)?.status !== 'ready')
      .map(base => base.id as KnowledgeBaseId)
    const hits: KnowledgeHit[] = []
    if (candidates.length === skippedBases.length) return { hits, skippedBases }
    const [vector] = await this.embedding.embed([query], true)
    if (vector === undefined) throw new Error('Embedding model returned no query vector')
    signal.throwIfAborted()
    for (const base of candidates.filter(
      item => !skippedBases.includes(item.id as KnowledgeBaseId),
    )) {
      const index = this.manifest.indexes[base.id]
      if (!index || !index.chunks || index.revision !== base.revision) continue
      const table = await this.db.openTable(index.table)
      try {
        const rows = z.array(hitSchema).parse(await table
          .vectorSearch(vector)
          .distanceType('cosine')
          .limit(this.config.searchLimit)
          .toArray())
        signal.throwIfAborted()
        if (this.manifest.bases.find(item => item.id === base.id)?.revision !== base.revision)
          continue
        for (const row of rows)
          hits.push({
            baseId: base.id as KnowledgeBaseId,
            baseTitle: base.title,
            documentId: row.documentId as KnowledgeDocumentId,
            title: row.title,
            ordinal: row.ordinal,
            content: row.content,
            score: 1 - row._distance,
          })
      } finally {
        table.close()
      }
    }
    return {
      hits: hits.sort((a, b) => b.score - a.score).slice(0, this.config.searchLimit),
      skippedBases,
    }
  }
  private requireBase(id: string): KnowledgeBase {
    const base = this.manifest.bases.find(item => item.id === id)
    if (!base) throw new Error('Knowledge base does not exist')
    return base as KnowledgeBase
  }
  private modelKey(): string {
    return `${this.config.model}:q8:cls:${this.config.queryPrefix}`
  }
  private requireStatus(id: string): IndexStatus {
    const status = this.statuses.get(id)
    if (status === undefined) throw new Error('Knowledge index status does not exist')
    return status
  }
  private validateDocuments(documents: Array<{ id: string; content: string }>): void {
    if (new Set(documents.map(document => document.id)).size !== documents.length)
      throw new Error('Duplicate document id')
    if (documents.some(document => document.content.length > this.config.maxDocumentChars))
      throw new Error('Document is too large')
    if (
      documents.reduce((sum, document) => sum + document.content.length, 0) >
      this.config.maxLibraryChars
    )
      throw new Error('Knowledge library is too large')
  }
  private schedule(id: string): void {
    if (this.jobs.has(id) || this.lifetime.signal.aborted) return
    const task = this.build(id).finally(() => {
      this.jobs.delete(id)
      if (this.statuses.get(id)?.status === 'pending') this.schedule(id)
    })
    this.jobs.set(id, task)
  }
  private async tableExists(name: string): Promise<boolean> {
    let pageToken: string | undefined
    do {
      const page = await this.db.listTables(pageToken === undefined ? {} : { pageToken })
      if (page.tables.includes(name)) return true
      pageToken = page.pageToken
    } while (pageToken)
    return false
  }
  private async build(id: string): Promise<void> {
    const base = this.requireBase(id)
    const state = idleIndex('indexing')
    this.statuses.set(id, state)
    const tableName = `kb_${randomUUID().replaceAll('-', '')}`
    let created = false
    try {
      const chunks = await this.preview(base.documents, base.split)
      state.total = chunks.length
      for (let offset = 0; offset < chunks.length; offset += this.config.batchSize) {
        this.lifetime.signal.throwIfAborted()
        if (this.manifest.bases.find(item => item.id === id)?.revision !== base.revision) return
        const batch = chunks.slice(offset, offset + this.config.batchSize)
        const vectors = await this.embedding.embed(batch.map(chunk => chunk.content))
        const rows = batch.map((chunk, i) => {
          const vector = vectors[i]
          if (vector === undefined) throw new Error('Embedding model returned an incomplete batch')
          return { ...chunk, vector }
        })
        const table = created
          ? await this.db.openTable(tableName)
          : await this.db.createTable(tableName, rows)
        try {
          if (created) await table.add(rows)
          created = true
        } finally {
          table.close()
        }
        state.completed += batch.length
      }
      const previous = this.manifest.indexes[id]
      const committed = await this.mutate((next) => {
        if (next.bases.find(item => item.id === id)?.revision !== base.revision) return false
        next.indexes[id] = {
          table: tableName,
          revision: base.revision,
          model: this.modelKey(),
          chunks: chunks.length,
        }
        return true
      })
      if (committed) {
        created = false
        Object.assign(state, { status: 'ready', chunks: chunks.length })
        if (previous && (await this.tableExists(previous.table)))
          await this.db.dropTable(previous.table)
      }
    } catch (error) {
      if (this.statuses.get(id) === state)
        Object.assign(state, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
    } finally {
      if (created)
        await this.db.dropTable(tableName).catch((error: unknown) => {
          this.ctx.logger.warn('Could not remove abandoned knowledge index: %s', String(error))
        })
    }
  }
  private mutate<T>(change: (next: Manifest) => T): Promise<T> {
    const task = this.writes.then(async () => {
      this.lifetime.signal.throwIfAborted()
      const next = structuredClone(this.manifest)
      const result = change(next)
      const temporary = join(this.directory, `libraries-${randomUUID()}.tmp`)
      await writeFile(temporary, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, join(this.directory, 'libraries.json'))
      this.manifest = next
      this.refreshTools?.()
      return result
    })
    this.writes = task.catch(() => {})
    return task
  }
}
export default KnowledgeGateway
