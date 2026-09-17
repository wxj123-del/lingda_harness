import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type {
  KnowledgeBase,
  KnowledgeBaseDraft,
  KnowledgeChunk,
  KnowledgeOverview,
  KnowledgeSearch,
  LegacyKnowledgeBase,
  SplitOptions,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  Input,
  IconChevronLeftOutline14,
  IconCheckOutline16,
  IconFolderOpenOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { LayoutKey } from '../locales.ts'
import css from './KnowledgePanel.module.css'

type Id = KnowledgeBase['id']
type RemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message?: string; code?: string } }
export interface KnowledgePanelProps {
  overview: () => Promise<RemoteResult<KnowledgeOverview>>
  get: (id: Id) => Promise<RemoteResult<KnowledgeBase>>
  save: (draft: KnowledgeBaseDraft) => Promise<RemoteResult<KnowledgeBase>>
  remove: (id: Id, revision: number) => Promise<RemoteResult<void>>
  reindex: (id: Id) => Promise<RemoteResult<KnowledgeOverview['bases'][number]['index']>>
  preview: (
    documents: KnowledgeBase['documents'],
    split: SplitOptions,
  ) => Promise<RemoteResult<KnowledgeChunk[]>>
  search: (
    query: string,
    baseId: string,
    signal: AbortSignal,
  ) => Promise<RemoteResult<KnowledgeSearch>>
  importLegacy: (items: LegacyKnowledgeBase[]) => Promise<RemoteResult<number>>
  legacy: LegacyKnowledgeBase[] | undefined
  writable: boolean
  t: (key: LayoutKey) => string
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw new Error(result.error.message ?? result.error.code ?? 'Remote operation failed')
}
function freshBase(defaults: SplitOptions): KnowledgeBaseDraft {
  return {
    id: `kb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` as Id,
    title: '',
    description: '',
    enabled: true,
    split: defaults,
    documents: [],
    revision: 0,
  }
}
function freshDocument(): KnowledgeBase['documents'][number] {
  return {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` as KnowledgeBase['documents'][number]['id'],
    title: '',
    content: '',
    updatedAt: Date.now(),
  }
}

function statusText(status: string, t: KnowledgePanelProps['t']): string {
  return t(
    status === 'ready'
      ? 'kb.ready'
      : status === 'indexing'
        ? 'kb.indexing'
        : status === 'error'
          ? 'kb.failed'
          : status === 'empty'
            ? 'kb.emptyIndex'
            : 'kb.pending',
  )
}

/** Authoring surface for libraries, documents, splitting, indexing and retrieval verification. */
export function KnowledgePanel(props: KnowledgePanelProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [overview, setOverview] = useState<KnowledgeOverview | null>(null)
  const [savedDraft, setSavedDraft] = useState('')
  const [draft, setDraft] = useState<KnowledgeBaseDraft | null>(null)
  const [tab, setTab] = useState<'documents' | 'settings' | 'search'>('documents')
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchResult, setSearchResult] = useState<KnowledgeSearch | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<KnowledgeChunk[] | null>(null)
  const refresh = async () => {
    try {
      const next = unwrap(await props.overview())
      setOverview(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : props.t('kb.error'))
    }
  }
  useEffect(() => {
    const legacy = props.legacy
    if (legacy === undefined) return
    const lifetime = new AbortController()
    void (async () => {
      try {
        unwrap(await props.importLegacy(legacy))
        const next = unwrap(await props.overview())
        if (!lifetime.signal.aborted) setOverview(next)
      } catch (cause) {
        if (!lifetime.signal.aborted) setError(cause instanceof Error ? cause.message : props.t('kb.error'))
      }
    })()
    return () => {
      lifetime.abort()
    }
  }, [props.legacy])
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = unwrap(await props.overview())
        if (active) setOverview(next)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : props.t('kb.error'))
      }
      if (active)
        timer = setTimeout(() => {
          void poll()
        }, 1500)
    }
    timer = setTimeout(() => {
      void poll()
    }, 1500)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [props.overview])
  const open = async (id: Id) => {
    setBusy(true)
    setError(null)
    try {
      const next = unwrap(await props.get(id))
      setDraft(next)
      setSavedDraft(JSON.stringify(next))
      setDocumentId(next.documents[0]?.id ?? null)
      setPreview(null)
      setSearchResult(null)
      setTab('documents')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : props.t('kb.error'))
    } finally {
      setBusy(false)
    }
  }
  const dirty = draft !== null && JSON.stringify(draft) !== savedDraft
  const currentIndex = overview?.bases.find(base => base.id === draft?.id)?.index
  const document = draft?.documents.find(item => item.id === documentId) ?? draft?.documents[0]
  const updateDraft = (patch: Partial<KnowledgeBaseDraft>) => {
    if (draft) {
      setDraft({ ...draft, ...patch })
      setPreview(null)
      setSearchResult(null)
    }
  }
  const save = async () => {
    if (
      !draft ||
      !draft.title.trim() ||
      draft.documents.some(item => !item.title.trim()) ||
      !props.writable
    ) {
      setError(props.t('kb.titleRequired'))
      return
    }
    setBusy(true)
    setSaving(true)
    setError(null)
    try {
      const saved = unwrap(
        await props.save({
          ...draft,
          title: draft.title.trim(),
          documents: draft.documents.map(item => ({
            ...item,
            title: item.title.trim(),
            updatedAt: Date.now(),
          })),
        }),
      )
      setDraft(saved)
      setSavedDraft(JSON.stringify(saved))
      setOverview(unwrap(await props.overview()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : props.t('kb.error'))
    } finally {
      setBusy(false)
      setSaving(false)
    }
  }
  const create = () => {
    const next = freshBase(overview?.defaults ?? { mode: 'recursive', size: 400, overlap: 60 })
    setDraft(next)
    setSavedDraft(JSON.stringify(next))
    setError(null)
    setPreview(null)
    setSearchResult(null)
    setDocumentId(null)
    setTab('documents')
  }
  const remove = async () => {
    if (!draft || !props.writable || !window.confirm(props.t('kb.confirmRemove'))) return
    setBusy(true)
    try {
      unwrap(await props.remove(draft.id, draft.revision))
      setDraft(null)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : props.t('kb.error'))
    } finally {
      setBusy(false)
    }
  }
  const runSearch = async () => {
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    try {
      setSearchResult(
        unwrap(await props.search(query, draft?.id ?? '', new AbortController().signal)),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : props.t('kb.error'))
    } finally {
      setBusy(false)
    }
  }
  const rebuild = async () => {
    if (!draft || dirty || !props.writable) return
    setBusy(true)
    setError(null)
    try {
      unwrap(await props.reindex(draft.id))
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : props.t('kb.error'))
    } finally {
      setBusy(false)
    }
  }
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ''
    const added: KnowledgeBase['documents'] = []
    setError(null)
    try {
      for (const file of files) {
        if (file.size > 1_000_000 || !/\.(txt|md|markdown|json|csv|ya?ml)$/i.test(file.name)) {
          setError(props.t('kb.fileError'))
          continue
        }
        const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
        added.push({ ...freshDocument(), title: file.name, content })
      }
      updateDraft({ documents: [...(draft?.documents ?? []), ...added] })
      if (added[0]) setDocumentId(added[0].id)
    } catch {
      setError(props.t('kb.fileError'))
    }
  }
  if (!overview)
    return (
      <main className={css.page}>
        <div className={css.inner}>
          <p className={css.empty}>{props.t('kb.loading')}</p>
          {error && (
            <p role="alert" className={css.error}>
              {error}
            </p>
          )}
        </div>
      </main>
    )
  if (!draft)
    return (
      <main className={css.page}>
        <div className={css.inner}>
          <header className={css.header}>
            <h1>{props.t('nav.knowledge')}</h1>
            <div className={css.actions}>
              <Button
                icon={<IconRefreshOutline16 />}
                onClick={() => {
                  void refresh()
                }}
              >
                {props.t('kb.refresh')}
              </Button>
              <Button
                variant="primary"
                icon={<IconPlusOutline16 />}
                disabled={!props.writable}
                onClick={create}
              >
                {props.t('kb.new')}
              </Button>
            </div>
          </header>
          <div className={css.model}>
            <strong>{props.t('kb.model')}:</strong>
            <code>{overview.model.id}</code>
            <span>{props.t(`kb.model.${overview.model.status}`)}</span>
            {overview.model.status === 'loading' && (
              <progress value={overview.model.progress} max="100" />
            )}
            {overview.model.error && (
              <span role="alert" className={css.error}>
                {overview.model.error}
              </span>
            )}
          </div>
          <section className={css.grid}>
            {overview.bases.map(base => (
              <article className={css.card} key={base.id}>
                <h2>{base.title}</h2>
                <p>{base.description || props.t('kb.manage')}</p>
                <div className={css.metrics}>
                  <span>
                    {base.documentCount} {props.t('kb.documentUnit')}
                  </span>
                  <span>
                    {base.index.chunks} {props.t('kb.chunkUnit')}
                  </span>
                </div>
                <span className={css.status} data-state={base.index.status}>
                  {statusText(base.index.status, props.t)}
                </span>
                <div className={css.actions}>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void open(base.id)
                    }}
                  >
                    {props.t('kb.manage')}
                  </Button>
                </div>
              </article>
            ))}
          </section>
          {overview.bases.length === 0 && <p className={css.empty}>{props.t('kb.empty')}</p>}
          {error && (
            <p className={css.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </main>
    )
  return (
    <main className={css.page}>
      <div className={css.inner}>
        <header className={css.header}>
          <div className={css.actions}>
            <Button
              icon={<IconChevronLeftOutline14 />}
              onClick={() => {
                if (!dirty || window.confirm(props.t('kb.discard'))) {
                  setDraft(null)
                  setError(null)
                }
              }}
            >
              {props.t('kb.back')}
            </Button>
            <h1>{draft.title || props.t('kb.new')}</h1>
          </div>
          <div className={css.actions}>
            <Button
              variant="primary"
              icon={<IconCheckOutline16 />}
              disabled={busy || !props.writable}
              onClick={() => {
                void save()
              }}
            >
              {saving ? props.t('kb.saving') : props.t('kb.saveIndex')}
            </Button>
            {draft.revision > 0 && (
              <Button
                disabled={busy || !props.writable}
                onClick={() => {
                  void remove()
                }}
              >
                {props.t('kb.remove')}
              </Button>
            )}
          </div>
        </header>
        <div className={css.model}>
          <span>
            {dirty
              ? props.t('kb.dirty')
              : draft.revision > 0
                ? props.t('kb.saved')
                : props.t('kb.new')}
          </span>
          {currentIndex && (
            <>
              <span className={css.status} data-state={currentIndex.status}>
                {statusText(currentIndex.status, props.t)}
              </span>
              <span>
                {currentIndex.status === 'indexing'
                  ? `${currentIndex.completed} / ${currentIndex.total}`
                  : currentIndex.chunks}{' '}
                {props.t('kb.chunkUnit')}
              </span>
              <Button
                size="sm"
                icon={<IconRefreshOutline16 />}
                disabled={busy || dirty || !props.writable || currentIndex.status === 'indexing'}
                onClick={() => {
                  void rebuild()
                }}
              >
                {props.t('kb.rebuild')}
              </Button>
            </>
          )}
          <span>
            {props.t('kb.model')}: <code>{overview.model.id}</code>
          </span>
          <span>{props.t(`kb.model.${overview.model.status}`)}</span>
          {overview.model.status === 'loading' && (
            <progress value={overview.model.progress} max="100" />
          )}
          {(currentIndex?.error || overview.model.error) && (
            <span role="alert" className={css.error}>
              {currentIndex?.error || overview.model.error}
            </span>
          )}
        </div>
        <label>
          <span>{props.t('name')}</span>
          <Input
            value={draft.title}
            onChange={(event) => {
              updateDraft({ title: event.target.value })
            }}
          />
        </label>
        <label>
          <span>{props.t('description')}</span>
          <Input
            value={draft.description}
            onChange={(event) => {
              updateDraft({ description: event.target.value })
            }}
          />
        </label>
        <label className={css.status}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => {
              updateDraft({ enabled: event.target.checked })
            }}
          />
          {props.t('kb.enabled')}
        </label>
        <div className={css.tabs} role="tablist">
          {(['documents', 'settings', 'search'] as const).map(value => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => {
                setTab(value)
              }}
            >
              {props.t(
                `kb.${value === 'documents' ? 'documents' : value === 'settings' ? 'settings' : 'searchTab'}`,
              )}
            </button>
          ))}
        </div>
        {tab === 'documents' && (
          <section className={css.documents}>
            <aside className={css.list}>
              <div className={css.documentToolbar}>
                <Button
                  className={css.documentAction}
                  size="sm"
                  variant="outline"
                  icon={<IconPlusOutline16 />}
                  disabled={!props.writable}
                  onClick={() => {
                    const next = freshDocument()
                    updateDraft({ documents: [...draft.documents, next] })
                    setDocumentId(next.id)
                  }}
                >
                  {props.t('kb.newDocument')}
                </Button>
                <Button
                  className={css.documentAction}
                  size="sm"
                  variant="outline"
                  icon={<IconFolderOpenOutline16 />}
                  disabled={!props.writable}
                  onClick={() => {
                    fileInput.current?.click()
                  }}
                >
                  {props.t('kb.upload')}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  disabled={!props.writable}
                  accept=".txt,.md,.markdown,.json,.csv,.yaml,.yml,text/plain,text/markdown"
                  onChange={(event) => {
                    void upload(event)
                  }}
                />
              </div>
              <div className={css.documentListHeader}>
                <strong>{props.t('kb.documents')}</strong>
                <span>{draft.documents.length} {props.t('kb.documentUnit')}</span>
              </div>
              <div className={css.documentScroll}>
                {draft.documents.map(item => (
                  <button
                    className={css.documentRow}
                    type="button"
                    key={item.id}
                    aria-pressed={document?.id === item.id}
                    onClick={() => {
                      setDocumentId(item.id)
                    }}
                  >
                    <span className={css.documentRowTitle}>
                      {item.title || props.t('kb.documentTitle')}
                    </span>
                    <span className={css.documentRowMeta}>
                      {item.content.length.toLocaleString()} {props.t('kb.charUnit')}
                    </span>
                  </button>
                ))}
              </div>
            </aside>
            <div className={css.editor}>
              {document ? (
                <>
                  <label>
                    <span>{props.t('kb.documentTitle')}</span>
                    <Input
                      value={document.title}
                      onChange={(event) =>{
                        updateDraft({
                          documents: draft.documents.map(item =>
                            item.id === document.id ? { ...item, title: event.target.value } : item,
                          ),
                        }) }
                      }
                    />
                  </label>
                  <label>
                    <span>{props.t('kb.documentContent')}</span>
                    <textarea
                      value={document.content}
                      onChange={(event) =>{
                        updateDraft({
                          documents: draft.documents.map(item =>
                            item.id === document.id
                              ? { ...item, content: event.target.value }
                              : item,
                          ),
                        }) }
                      }
                    />
                  </label>
                  <Button
                    onClick={() => {
                      updateDraft({
                        documents: draft.documents.filter(item => item.id !== document.id),
                      })
                      setDocumentId(
                        draft.documents.find(item => item.id !== document.id)?.id ?? null,
                      )
                    }}
                  >
                    {props.t('kb.removeDocument')}
                  </Button>
                </>
              ) : (
                <p className={css.empty}>{props.t('kb.noDocuments')}</p>
              )}
            </div>
          </section>
        )}
        {tab === 'settings' && (
          <section>
            <div className={css.settings}>
              <label>
                <span>{props.t('kb.mode')}</span>
                <select
                  value={draft.split.mode}
                  onChange={(event) =>{
                    updateDraft({
                      split: { ...draft.split, mode: event.target.value as SplitOptions['mode'] },
                    }) }
                  }
                >
                  <option value="recursive">{props.t('kb.recursive')}</option>
                  <option value="markdown">{props.t('kb.markdown')}</option>
                  <option value="fixed">{props.t('kb.fixed')}</option>
                </select>
              </label>
              <label>
                <span>{props.t('kb.size')}</span>
                <Input
                  type="number"
                  min="64"
                  max="400"
                  value={draft.split.size}
                  onChange={(event) =>{
                    updateDraft({ split: { ...draft.split, size: Number(event.target.value) } }) }
                  }
                />
              </label>
              <label>
                <span>{props.t('kb.overlap')}</span>
                <Input
                  type="number"
                  min="0"
                  max="200"
                  value={draft.split.overlap}
                  onChange={(event) =>{
                    updateDraft({ split: { ...draft.split, overlap: Number(event.target.value) } }) }
                  }
                />
              </label>
            </div>
            <div className={css.actions}>
              <Button
                onClick={() => {
                  void props
                    .preview(draft.documents, draft.split)
                    .then((result) =>{  setPreview(unwrap(result)) })
                    .catch((cause: unknown) => {
                      setError(cause instanceof Error ? cause.message : props.t('kb.splitInvalid')) },
                    )
                }}
              >
                {props.t('kb.preview')}
              </Button>
            </div>
            {preview && (
              <div className={css.preview}>
                {preview.map(chunk => (
                  <div className={css.chunk} key={`${chunk.documentId}-${chunk.ordinal}`}>
                    <h3>
                      {chunk.title} · {chunk.ordinal + 1}
                    </h3>
                    <p>{chunk.content}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {tab === 'search' && (
          <section>
            <div className={css.search}>
              <Input
                value={query}
                aria-label={props.t('kb.query')}
                placeholder={props.t('kb.query')}
                onChange={(event) =>{  setQuery(event.target.value) }}
              />
              <Button
                variant="primary"
                disabled={
                  busy ||
                  !query.trim() ||
                  dirty ||
                  currentIndex?.status !== 'ready' ||
                  !draft.enabled
                }
                onClick={() => {
                  void runSearch()
                }}
              >
                {busy ? props.t('kb.searching') : props.t('kb.search')}
              </Button>
            </div>
            {searchResult?.skippedBases.length ? (
              <p className={css.error}>{props.t('kb.skipped')}</p>
            ) : null}
            {searchResult?.hits.length ? (
              searchResult.hits.map(hit => (
                <article className={css.chunk} key={`${hit.documentId}-${hit.ordinal}`}>
                  <h3>
                    {hit.baseTitle} / {hit.title} · {hit.ordinal + 1} · {props.t('kb.similarity')}{' '}
                    {(hit.score * 100).toFixed(1)}%
                  </h3>
                  <p>{hit.content}</p>
                </article>
              ))
            ) : searchResult ? (
              <p className={css.empty}>{props.t('kb.noHits')}</p>
            ) : null}
          </section>
        )}
        {error && (
          <p className={css.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  )
}
