/** Tool catalog and recorded usage, independent of plugin management. */
import { useEffect, useState } from 'react'
import type { ToolUsageSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Input, Modal, Tooltip, IconSearchOutline16, IconRefreshOutline16, IconApiOutline14, IconPlusOutline16, IconEditOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthoringItem } from '../../authoring-settings.ts'
import { runtimeToolName } from '../../runtime-tool-name.ts'
import type { LayoutKey } from '../locales.ts'
import { ToolEditor } from './ToolEditor.tsx'
import css from './SkillsPanel.module.css'
import tools from './ToolsPanel.module.css'

/** Data and callbacks supplied by the Tools main-panel registration. */
export interface ToolsPanelProps {
  items: readonly AuthoringItem[]
  writable: boolean
  loadUsage: (signal: AbortSignal) => Promise<ToolUsageSnapshot>
  save: (item: AuthoringItem) => Promise<void>
  t: (key: LayoutKey) => string
}

type CatalogTool = ToolUsageSnapshot['tools'][number] & { title: string; item?: AuthoringItem }
type ViewState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; snapshot: ToolUsageSnapshot }
type Filter = 'all' | 'used' | 'unused' | 'mine'

const descriptionKeys = new Map<string, LayoutKey>(([
  'bash', 'edit', 'read', 'grep', 'read_image', 'glob', 'write', 'present', 'todo_write',
  'generate_image', 'list_image_models', 'generate_speech', 'list_speech_models', 'skill', 'ask_user_question',
  'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self', 'cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine',
  'create_goal', 'get_goal', 'update_goal', 'exit_plan_mode', 'job_output', 'job_list', 'job_kill',
  'subagent', 'subagent_fork', 'list_agents', 'interrupt_agent', 'send_message', 'workflow', 'web_fetch', 'web_search',
  'preset_ops', 'article_preset_verdict',
] as const).map(name => [name, `tool.description.${name}`]))

/** @param props - Saved custom tools and cancellable usage reader. @returns Searchable tool cards and details. */
export function ToolsPanel({ items, writable, loadUsage, save, t }: ToolsPanelProps) {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState('calls')
  const [detailName, setDetailName] = useState<string | null>(null)
  const [draft, setDraft] = useState<AuthoringItem | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void loadUsage(controller.signal).then((snapshot) => {
      if (!controller.signal.aborted) setState({ status: 'ready', snapshot })
    }, () => {
      if (!controller.signal.aborted) setState({ status: 'error' })
    })
    return () => { controller.abort() }
  }, [loadUsage, revision])
  const snapshot = state.status === 'ready' ? state.snapshot : undefined
  const catalog = new Map<string, CatalogTool>((snapshot?.tools ?? []).map(tool => [tool.name, { ...tool, title: tool.name }]))
  for (const item of items) {
    const name = runtimeToolName('tool', item)
    const recorded = catalog.get(name)
    catalog.set(name, { name, calls: 0, directCalls: 0, internalCalls: 0,
      exposedRequests: 0, usedRequests: 0, sessions: 0, lastUsedAt: null,
      ...recorded, title: item.title, description: item.description || item.body, item })
  }
  const all = [...catalog.values()]
  const describe = (tool: CatalogTool) => {
    const key = tool.item === undefined ? descriptionKeys.get(tool.name) : undefined
    return key === undefined ? tool.description || t('tool.noDescription') : t(key)
  }
  const matches = (tool: CatalogTool, value: Filter) => value === 'all' || (value === 'used' ? tool.calls > 0 : value === 'unused' ? tool.calls === 0 : tool.item !== undefined)
  const needle = query.trim().toLocaleLowerCase()
  const rate = (tool: CatalogTool) => tool.exposedRequests === 0 ? Infinity : tool.usedRequests / tool.exposedRequests
  const shown = all.filter(tool => matches(tool, filter) && [tool.name, tool.title, describe(tool), tool.description ?? ''].join(' ').toLocaleLowerCase().includes(needle))
    .sort((a, b) => (sort === 'name' ? 0 : sort === 'exposure' ? b.exposedRequests - a.exposedRequests
      : sort === 'rate' ? rate(a) - rate(b) || b.exposedRequests - a.exposedRequests : b.calls - a.calls) || a.name.localeCompare(b.name))
  const totals = all.reduce((sum, tool) => ({
    calls: sum.calls + tool.calls, exposures: sum.exposures + tool.exposedRequests, hits: sum.hits + tool.usedRequests,
  }), { calls: 0, exposures: 0, hits: 0 })
  const hitRate = (hits: number, exposures: number) => exposures === 0 ? t('tool.noMetric')
    : new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(hits / exposures)
  const detail = detailName === null ? undefined : catalog.get(detailName)
  const detailItem = detail?.item
  const lastCall = (value: number | null) => value === null ? t('tool.never') : new Date(value).toLocaleString()
  const create = () => { setDraft({ id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: '', description: '', body: '', steps: [], enabled: true, updatedAt: 0 }) }
  if (draft !== null) return <ToolEditor initial={draft} writable={writable} save={save} close={() => { setDraft(null) }} t={t} />
  return <main className={css.page} data-tool-catalog="">
    <div className={css.inner}>
      <header className={css.header}>
        <div className={css.heading}><IconApiOutline14 size={28} /><h1>{t('tool.title')}</h1>{snapshot && <span className={css.total}>{all.length}</span>}</div>
        <div className={tools.actions}>
          <Tooltip label={t('tool.refresh')}><button className={tools.refresh} type="button" aria-label={t('tool.refresh')} disabled={state.status === 'loading'} onClick={() => { setRevision(value => value + 1) }}><IconRefreshOutline16 /></button></Tooltip>
          <Button variant="primary" icon={<IconPlusOutline16 />} disabled={!writable} onClick={create}>{t('tool.new')}</Button>
        </div>
      </header>
      {snapshot && <dl className={tools.overview} aria-label={t('tool.metrics')}>
        <div><dt>{t('tool.requests')}</dt><dd>{snapshot.requestCount}</dd></div>
        <div><dt><Tooltip label={t('tool.exposureHint')}><span tabIndex={0}>{t('tool.exposures')}</span></Tooltip></dt><dd>{totals.exposures}</dd></div>
        <div><dt><Tooltip label={t('tool.hitHint')}><span tabIndex={0}>{t('tool.hits')}</span></Tooltip></dt><dd>{totals.hits}</dd></div>
        <div><dt><Tooltip label={t('tool.rateHint')}><span tabIndex={0}>{t('tool.hitRate')}</span></Tooltip></dt><dd>{hitRate(totals.hits, totals.exposures)}</dd></div>
      </dl>}
      <div className={css.toolbar}>
        <div className={css.sources} role="group" aria-label={t('tool.filter')}>
          {(['all', 'used', 'unused', 'mine'] as const).map(value => <button type="button" className={css.source} key={value} aria-label={t(`tool.${value}`)} aria-pressed={filter === value} onClick={() => { setFilter(value) }}>
            {t(`tool.${value}`)}{snapshot && <span>{all.filter(tool => matches(tool, value)).length}</span>}
          </button>)}
        </div>
        <Input className={css.search ?? ''} type="search" icon={<IconSearchOutline16 />} value={query} aria-label={t('tool.search')} placeholder={t('tool.search')} onChange={(event) => { setQuery(event.target.value) }} />
      </div>
      <div className={tools.summary}>
        <div>{snapshot && <><span>{snapshot.sessionCount} {t('tool.sessionUnit')}</span><span>{t('tool.total')} <strong>{totals.calls}</strong> {t('tool.callUnit')}</span></>}</div>
        <select className={tools.sort} aria-label={t('tool.sort')} value={sort} onChange={(event) => { setSort(event.target.value) }}><option value="calls">{t('tool.sortCalls')}</option><option value="exposure">{t('tool.sortExposure')}</option><option value="rate">{t('tool.sortHitRate')}</option><option value="name">{t('tool.sortName')}</option></select>
      </div>
      {state.status === 'loading' && <p role="status" className={css.empty}>{t('tool.loading')}</p>}
      {state.status === 'error' && <p role="alert" className={css.error}>{t('tool.error')}</p>}
      {snapshot && <>
        {snapshot.failedSessionCount > 0 && <p role="alert" className={css.error}>{snapshot.failedSessionCount} {t('tool.partial')}</p>}
        {snapshot.unknownCatalogRequests > 0 && <p role="status" className={tools.scope}>{snapshot.unknownCatalogRequests} {t('tool.unknownCatalog')}</p>}
        <section className={css.grid} aria-label={t('tool.all')}>
          {shown.map(tool => <article className={css.card} key={tool.name} data-tool-name={tool.name} aria-label={tool.title}>
            <div className={css.cardTop}><span className={css.skillIcon}><IconApiOutline14 size={24} /></span><span className={css.badge}>{t(tool.item ? 'tool.custom' : 'tool.recorded')}</span></div>
            <button type="button" className={css.cardTitle} onClick={() => { setDetailName(tool.name) }}><h2 className={tools.title}>{tool.title}</h2></button>
            <p className={css.description}>{describe(tool)}</p>
            <dl className={tools.cardMetrics}>
              <div><dt>{t('tool.exposures')}</dt><dd>{tool.exposedRequests}</dd></div>
              <div><dt>{t('tool.hitRate')}</dt><dd>{hitRate(tool.usedRequests, tool.exposedRequests)}</dd></div>
            </dl>
            <div className={css.metadata}><span>{t('tool.last')}: {lastCall(tool.lastUsedAt)}</span>{tool.item && <span className={css.state} data-enabled={tool.item.enabled}>{t(tool.item.enabled ? 'tool.enabled' : 'tool.disabled')}</span>}</div>
            <div className={css.cardActions}><span className={tools.usage}>{t('tool.calls')} <strong>{tool.calls}</strong> {t('tool.callUnit')}</span><Button size="sm" onClick={() => { setDetailName(tool.name) }}>{t('tool.details')}</Button></div>
          </article>)}
        </section>
        {shown.length === 0 && <div className={css.empty}><h3>{t('tool.empty')}</h3><Button onClick={() => { setQuery(''); setFilter('all') }}>{t('tool.reset')}</Button></div>}
      </>}
    </div>
    {detail && snapshot && <Modal open title={detail.title} closeLabel={t('tool.close')} onClose={() => { setDetailName(null) }} className={tools.dialog ?? ''} contentClassName={css.detailContent ?? ''}
      footer={detailItem && <div className={css.detailActions}><Button icon={<IconEditOutline16 />} disabled={!writable} onClick={() => { setDraft(detailItem); setDetailName(null) }}>{t('tool.edit')}</Button></div>}>
      <div className={tools.detail}>
        <code className={tools.name}>{detail.name}</code><p className={tools.description}>{describe(detail)}</p>
        <dl className={tools.metrics}>
          <div><dt>{t('tool.calls')}</dt><dd>{detail.calls}</dd></div><div><dt>{t('tool.direct')}</dt><dd>{detail.directCalls}</dd></div>
          <div><dt>{t('tool.internal')}</dt><dd>{detail.internalCalls}</dd></div><div><dt>{t('tool.sessions')}</dt><dd>{detail.sessions}</dd></div>
          <div><dt>{t('tool.exposures')}</dt><dd>{detail.exposedRequests}</dd></div><div><dt>{t('tool.hits')}</dt><dd>{detail.usedRequests}</dd></div>
          <div><dt>{t('tool.hitRate')}</dt><dd>{hitRate(detail.usedRequests, detail.exposedRequests)}</dd></div>
        </dl>
        <p className={tools.timestamp}>{t('tool.last')}: {lastCall(detail.lastUsedAt)}</p>
        <p className={tools.scope}>{t('tool.scope')}</p>
        <p className={tools.scope}>{t('tool.hitHint')} {t('tool.rateHint')}</p>
        {detail.item && <><h3>{t('instructions')}</h3><p className={tools.description}>{detail.item.body}</p>{detail.item.steps.length > 0 && <ol>{detail.item.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}</>}
        {!detail.item && descriptionKeys.has(detail.name) && detail.description && <details className={tools.schema}><summary>{t('tool.originalDescription')}</summary><p className={tools.description}>{detail.description}</p></details>}
        {detail.parameters !== undefined && <details className={tools.schema}><summary>{t('tool.parameters')}</summary><pre>{JSON.stringify(detail.parameters, null, 2)}</pre></details>}
        {!detail.item && detail.parameters === undefined && <p className={tools.scope}>{t('tool.noParameters')}</p>}
      </div>
    </Modal>}
  </main>
}
