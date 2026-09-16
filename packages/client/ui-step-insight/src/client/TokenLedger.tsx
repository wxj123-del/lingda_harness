/** Live Token ledger replacing the registered trajectory presentation. */
import { useEffect, useMemo, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconDownloadOutline16, IconSearchOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StepInsightInjected } from './types.ts'
import { createStepReader } from './step-model.ts'
import { contentText, estimateText } from './usage.ts'
import { accounted, number, rowLabel } from './format.ts'
import { RequestDetail } from './RequestDetail.tsx'
import css from './ledger.module.css'

/** Props assembled by the conversation slot, locale and private event hook. */
export type TokenLedgerProps = ConvViewProps & InjectFace<StepInsightInjected> & PropsLocale<'stepInsight'>

/** @param props - renderer-bound Session data. @returns The live accounting view. */
export function TokenLedger({ useLedgerEvents, useSession, loadOlder, viewRequest, completeViewRequest, t }: TokenLedgerProps) {
  const window = useLedgerEvents(value => value)
  const loading = useSession(value => value.loadingOlder)
  const readSteps = useMemo(createStepReader, [])
  const rows = readSteps(window)
  const inspectCallId = viewRequest?.view === 'trajectory' ? viewRequest.focus : null
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('chronological')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [limit, setLimit] = useState(100)
  const [error, setError] = useState<string | null>(null)
  const [initialTab, setInitialTab] = useState<'inputTab' | 'toolsTab'>('inputTab')
  useEffect(() => {
    if (!inspectCallId) return
    const match = rows.find(row => row.tools.some(tool => tool.id === inspectCallId))
    if (match === undefined) return
    setSelectedId(match.id)
    setInitialTab('toolsTab')
    completeViewRequest()
  }, [inspectCallId, rows, completeViewRequest])
  const selected = rows.find(row => row.id === selectedId) ?? rows.at(-1)
  const totals = rows.reduce((sum, row) => ({
    total: sum.total + (row.usage.total ?? row.usage.minimumTotal ?? 0),
    input: sum.input + (row.usage.prompt ?? row.usage.minimumPrompt ?? 0),
    output: sum.output + (row.usage.output ?? 0), cache: sum.cache + (row.usage.cacheRead ?? 0),
    incomplete: sum.incomplete + Number(row.usage.total === null),
  }), { total: 0, input: 0, output: 0, cache: 0, incomplete: 0 })
  const needle = query.trim().toLocaleLowerCase()
  const filtered = rows.filter((row) => {
    if (filter === 'missing' && row.usage.total !== null) return false
    if (filter === 'errors' && !['error', 'interrupted', 'attempt'].includes(row.status)) return false
    return needle === '' || [rowLabel(row, t), row.model, row.provider, ...row.tools.map(tool => tool.name)]
      .join(' ').toLocaleLowerCase().includes(needle)
  })
  if (sort === 'expensive') filtered.sort((a, b) => (b.usage.total ?? b.usage.minimumTotal ?? -1) - (a.usage.total ?? a.usage.minimumTotal ?? -1))
  const visible = sort === 'chronological' ? filtered.slice(-limit) : filtered.slice(0, limit)
  const summaries = [
    ['total', totals.total, rows.some(row => row.usage.minimumTotal !== null), totals.incomplete > 0],
    ['input', totals.input, rows.some(row => row.usage.minimumPrompt !== null), rows.some(row => row.usage.prompt === null)],
    ['output', totals.output, rows.some(row => row.usage.output !== null), rows.some(row => row.usage.output === null)],
    ['cache', totals.cache, rows.some(row => row.usage.cacheRead !== null), rows.some(row => row.usage.cacheRead === null)],
  ] as const
  const download = () => {
    try {
      const blob = new Blob([JSON.stringify({ format: 'dsh-token-ledger-v1', scope: 'loaded-history',
        hasEarlierHistory: window.hasMore, rows: rows.map(row => ({ ...row,
          inputBeforeSeq: Number.isFinite(row.inputBeforeSeq) ? row.inputBeforeSeq : null })),
        events: window.entries.filter(entry => entry.type === 'event').map(entry => entry.event),
      }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'token-ledger.json'
      link.click()
      setTimeout(() =>{  URL.revokeObjectURL(url) }, 1000)
      setError(null)
    } catch {
      setError(t('exportError'))
    }
  }
  const older = async () => {
    setError(null)
    try { await loadOlder() } catch { setError(t('loadError')) }
  }
  return <section className={css.root} aria-label={t('title')} data-token-ledger="" data-conversation-composer-overlay="">
    <div className={css.toolbar}>
      <label className={css.search}><IconSearchOutline16 /><input type="search" aria-label={t('search')} placeholder={t('search')}
        value={query} onChange={(event) =>{  setQuery(event.target.value) }} /></label>
      <select aria-label={t('filter')} value={filter} onChange={(event) =>{  setFilter(event.target.value) }}>
        {(['all', 'missing', 'errors'] as const).map(key => <option key={key} value={key}>{t(key)}</option>)}
      </select>
      <select aria-label={t('sort')} value={sort} onChange={(event) =>{  setSort(event.target.value) }}>
        {(['chronological', 'expensive'] as const).map(key => <option key={key} value={key}>{t(key)}</option>)}
      </select>
      <Tooltip label={t('export')}><button className={css.iconButton} type="button" aria-label={t('export')} onClick={download}><IconDownloadOutline16 /></button></Tooltip>
    </div>
    <div className={css.summary}>
      {summaries.map(([key, value, known, partial]) => <div key={key}><span>{t(key)}</span><strong>{known && partial ? '≥' : ''}{number(known ? value : null)}</strong></div>)}
    </div>
    <div className={css.scope}><span>{t('loaded')}: {rows.length}</span><span>{t('incomplete')}: {totals.incomplete}</span>
      {window.hasMore && <button type="button" disabled={loading} onClick={() => { void older() }}>{t(loading ? 'loading' : 'loadOlder')}</button>}
    </div>
    {window.hasMore && <p className={css.notice}>{t('partialHistory')}</p>}
    {totals.incomplete > 0 && <p className={css.notice}>{t('lowerBound')}</p>}
    {error && <p role="alert" className={css.notice}>{error}</p>}
    <div className={css.workspace}>
      <div className={css.list}>
        {filtered.length > limit && <button className={css.more} type="button" onClick={() =>{  setLimit(value => value + 100) }}>{t('more')} ({visible.length}/{filtered.length})</button>}
        <div className={css.tableScroll}>
          <table className={css.table} aria-label={t('requests')}>
            <thead><tr><th>{t('step')}</th><th>{t('input')}</th><th>{t('cache')}</th><th>{t('output')}</th><th>{t('total')}</th></tr></thead>
            <tbody>{visible.map((row) => {
              const streaming = row.status === 'streaming' || row.status === 'waiting'
              return <tr key={row.id} data-selected={selected?.id === row.id} data-token-request={row.id}>
                <td><button type="button" className={css.requestButton} aria-pressed={selected?.id === row.id}
                  onClick={() => { setSelectedId(row.id); setInitialTab('inputTab') }}>
                  <b>{rowLabel(row, t)}</b><span>{row.model ?? t('unreported')}</span>
                  <small data-status={row.status}>{t(row.status === 'attempt' ? 'attemptStatus' : row.status)}{row.tools.length > 0 ? ` · ${row.tools.length} ${t('toolsTab')}` : ''}</small>
                </button></td>
                <td title={row.usage.prompt === null ? t('lowerBound') : t('reported')}>{accounted(row.usage.prompt, row.usage.minimumPrompt)}</td>
                <td className={css.cacheNumber}>{number(row.usage.cacheRead)}</td>
                <td>{row.usage.output === null && streaming && row.output.length > 0
                  ? <span title={t('liveEstimate')}>~{number(estimateText(contentText(row.output)))}</span> : number(row.usage.output)}</td>
                <td><strong>{accounted(row.usage.total, row.usage.minimumTotal)}</strong>{row.usage.total === null && <small>{t(streaming ? 'pending' : 'missing')}</small>}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
        {visible.length === 0 && <div className={css.empty}>{t(rows.length === 0 ? 'empty' : 'noMatches')}</div>}
      </div>
      {selected && <RequestDetail key={`${selected.id}:${initialTab}`} row={selected} window={window} t={t} initialTab={initialTab} />}
    </div>
  </section>
}
