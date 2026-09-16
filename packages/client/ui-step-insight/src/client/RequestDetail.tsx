/** Selected request accounting and inspectable source content. */
import { useRef, useState } from 'react'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { StepRow } from './types.ts'
import type { Translate } from './locales.ts'
import { inspectInput } from './input-parts.ts'
import { contentText, estimateText, hasMedia } from './usage.ts'
import { accounted, number, rowLabel } from './format.ts'
import { ToolSimilarityList } from './ToolSimilarityList.tsx'
import css from './ledger.module.css'

interface DetailProps {
  row: StepRow
  window: SessionEventWindow
  t: Translate
  initialTab?: 'inputTab' | 'toolsTab'
}

/** @param props - selected row and authoritative loaded events. @returns Local request inspector. */
export function RequestDetail({ row, window, t, initialTab = 'inputTab' }: DetailProps) {
  const [tab, setTab] = useState<'inputTab' | 'outputTab' | 'toolsTab' | 'rawTab'>(initialTab)
  const cached = useRef<{ window: SessionEventWindow; before: number; input: ReturnType<typeof inspectInput> }>()
  let previous = cached.current
  if (previous === undefined || previous.before !== row.inputBeforeSeq
    || (previous.window !== window && (window.change.kind !== 'append'
      || row.inputBeforeSeq === Infinity || window.revision !== previous.window.revision + 1))) {
    previous = { window, before: row.inputBeforeSeq, input: inspectInput(window.entries, row, window.hasMore) }
  } else previous.window = window
  cached.current = previous
  const input = previous.input
  const usage = row.usage
  const duration = row.startTime === null || row.endTime === null ? null : row.endTime - row.startTime
  const ttft = row.startTime === null || row.firstTokenTime === null ? null : row.firstTokenTime - row.startTime
  const decode = row.firstTokenTime === null || row.endTime === null ? null : row.endTime - row.firstTokenTime
  const rate = decode !== null && decode > 0 && usage.output !== null ? usage.output * 1000 / decode : null
  const metrics = [
    ['uncached', usage.input], ['cache', usage.cacheRead], ['cacheWrite', usage.cacheWrite],
    ['unknownInput', usage.unclassified], ['input', usage.prompt], ['output', usage.output],
    ['reasoning', usage.reasoning], ['total', usage.total],
  ] as const
  return <aside className={css.detail} aria-label={t('select')} data-token-detail="">
    <header className={css.detailHeader}>
      <h3>{rowLabel(row, t)}</h3>
      <span className={css.muted}>{row.provider ?? t('unreported')} / {row.model ?? t('unreported')}</span>
      <span className={css.muted}>{t('event')} #{row.seq}{row.endSeq === undefined ? '' : ` → #${row.endSeq}`}</span>
    </header>
    <dl className={css.accounting}>
      {metrics.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd title={value === null ? t('unreported') : t('reported')}>{key === 'total' ? accounted(value, usage.minimumTotal) : key === 'input' ? accounted(value, usage.minimumPrompt) : number(value)}</dd></div>)}
      <div><dt>{t('duration')}</dt><dd>{number(duration)} {t('milliseconds')}</dd></div>
      <div><dt>{t('firstToken')}</dt><dd>{number(ttft)} {t('milliseconds')}</dd></div>
      <div><dt>{t('throughput')}</dt><dd>{number(rate)}</dd></div>
      <div><dt>{t('cacheRate')}</dt><dd>{number(usage.prompt !== null && usage.prompt > 0 && usage.cacheRead !== null ? usage.cacheRead / usage.prompt * 100 : null)}%</dd></div>
    </dl>
    {row.error !== undefined && <p role="alert" className={css.notice}>{row.error}</p>}
    <div className={css.tabs} role="tablist" aria-label={t('select')}>
      {(['inputTab', 'outputTab', 'toolsTab', 'rawTab'] as const).map(key => <button key={key} type="button" role="tab"
        aria-selected={tab === key} onClick={() =>{  setTab(key) }}>{t(key)}{key === 'toolsTab' ? ` (${row.tools.length})` : ''}</button>)}
    </div>
    <div className={css.detailBody} role="tabpanel" aria-label={t(tab)}>
      {tab === 'inputTab' && <>
        <p className={css.note}>{t('sourceEstimate')}</p>
        {input.incomplete && <p className={css.notice}>{t(row.kind === 'compaction' ? 'compactionInput' : 'partialInput')}</p>}
        {input.unsupported && <p className={css.notice}>{t('customProjection')}</p>}
        {input.parts.length === 0 && <p className={css.empty}>{t('noInput')}</p>}
        {input.parts.filter(part => part.kind !== 'schema').map(part => <details key={part.id} className={css.source}>
          <summary><span>{t(part.kind)} <small>#{part.seq}</small></span><b>~{number(part.tokens)}</b></summary>
          {part.source && <div className={css.sourceMeta}>{t('source')}: {part.source}</div>}
          {part.media && <p className={css.notice}>{t('mediaEstimate')}</p>}
          <pre>{part.text}</pre>
        </details>)}
        <ToolSimilarityList parts={input.parts} tools={row.tools} t={t} />
      </>}
      {tab === 'outputTab' && <>
        <p className={css.note}>{t(row.status === 'streaming' ? 'liveEstimate' : 'sourceEstimate')}</p>
        {row.output.length === 0 && <p className={css.empty}>{t('noOutput')}</p>}
        {row.output.map((block, index) => <details key={index} className={css.source} open>
          <summary><span>{t(block.type === 'text' ? 'answer' : block.type === 'reasoning' ? 'thinking' : block.type === 'tool-call' ? 'toolCall' : 'other')}</span>
            <b>~{number(estimateText(contentText([block])))}</b></summary>
          {hasMedia([block]) && <p className={css.notice}>{t('mediaEstimate')}</p>}
          <pre>{contentText([block])}</pre>
        </details>)}
      </>}
      {tab === 'toolsTab' && <>
        <p className={css.note}>{t('toolAccounting')}</p>
        {row.tools.length === 0 && <p className={css.empty}>{t('noTools')}</p>}
        {row.tools.map(tool => <details key={tool.id} className={css.source} open>
          <summary><span>{tool.name} <small>#{tool.seq}</small></span><b>{tool.isError ? t('error') : tool.result === null ? t('waiting') : t('complete')}</b></summary>
          {tool.parentId && <p className={css.note}>{t('subtool')}</p>}
          <div className={css.sourceMeta}>{t('arguments')} · ~{number(estimateText(tool.arguments))} {t('token')}</div>
          <pre>{tool.arguments}</pre>
          <div className={css.sourceMeta}>{t('result')} · {tool.result === null ? t('waiting') : `~${number(estimateText(contentText(tool.result)))} ${t('token')}`} · {number(tool.endTime === null || tool.startTime === null ? null : tool.endTime - tool.startTime)} {t('milliseconds')}</div>
          {tool.result !== null && hasMedia(tool.result) && <p className={css.notice}>{t('mediaEstimate')}</p>}
          {tool.result !== null && <pre>{contentText(tool.result)}</pre>}
        </details>)}
      </>}
      {tab === 'rawTab' && <>
        <details className={css.source} open><summary>{t('rawUsage')}</summary><pre>{row.rawUsage === undefined ? t('unreported') : JSON.stringify(row.rawUsage, null, 2)}</pre></details>
        {window.entries.filter(entry => entry.type === 'event' && row.evidence.includes(entry.event.seq)).map(({ event }) =>
          <details key={event.seq} className={css.source}>
            <summary>{event.type} #{event.seq}</summary><pre>{JSON.stringify(event, null, 2)}</pre>
          </details>)}
      </>}
    </div>
  </aside>
}
