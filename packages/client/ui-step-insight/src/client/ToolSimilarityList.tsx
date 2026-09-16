/** Tool schema inspection with transparent, request-local lexical relevance. */
import { useMemo, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputPart, ToolRow } from './types.ts'
import type { Translate } from './locales.ts'
import { compareTools } from './tool-similarity.ts'
import { number } from './format.ts'
import css from './ledger.module.css'

interface SimilarityProps {
  parts: readonly InputPart[]
  tools: readonly ToolRow[]
  t: Translate
}

/** @param props - request input, actual calls, and locale. @returns Ranked, expandable tool definitions. */
export function ToolSimilarityList({ parts, tools, t }: SimilarityProps) {
  const [scope, setScope] = useState<'latest' | 'all'>('latest')
  const [sort, setSort] = useState<'original' | 'similarity'>('original')
  const comparison = useMemo(() => compareTools(parts, scope), [parts, scope])
  const rows = sort === 'similarity'
    ? [...comparison.comparisons].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    : comparison.comparisons
  if (rows.length === 0) return null
  return <section className={css.similaritySection} aria-label={t('toolSimilarity')}>
    <header className={css.similarityHeader}>
      <h4>{t('toolSimilarity')} <span>({rows.length})</span></h4>
      <Tooltip label={t('similarityMethod')}><span className={css.estimateLabel} tabIndex={0}>{t('textEstimate')}</span></Tooltip>
    </header>
    <div className={css.similarityControls}>
      <label>{t('comparisonScope')}<select value={scope} onChange={(event) => { setScope(event.target.value === 'all' ? 'all' : 'latest') }}>
        <option value="latest">{t('latestUser')}</option><option value="all">{t('allUsers')}</option>
      </select></label>
      <label>{t('toolOrder')}<select value={sort} onChange={(event) => { setSort(event.target.value === 'similarity' ? 'similarity' : 'original') }}>
        <option value="original">{t('schemaOrder')}</option><option value="similarity">{t('similarityOrder')}</option>
      </select></label>
    </div>
    <details className={css.reference}>
      <summary>{t('comparisonText')} {comparison.sources.map(part => `#${part.seq}`).join(', ')}</summary>
      {comparison.sources.every(part => !part.userText?.trim()) ? <p className={css.note}>{t('noComparisonText')}</p>
        : comparison.sources.map(part => <pre key={part.id}>{part.userText}</pre>)}
      <p className={css.note}>{t('similarityMethod')}</p>
    </details>
    {rows.map(({ part, score, matches }) => <details key={part.id} className={`${css.source} ${css.schemaSource}`} data-tool-schema={part.source}>
      <summary>
        <span className={css.schemaTitle}><code>{part.source}</code><small>#{part.seq}</small>
          {tools.some(tool => tool.name === part.source) && <span className={css.called}>{t('called')}</span>}</span>
        <span className={css.schemaMetrics}>
          <span className={css.similarityMetric} title={t('similarityMethod')}>
            <span>{t('similarity')}</span>
            {score !== null && <meter min={0} max={100} value={score} aria-label={`${part.source} ${t('similarity')}`} />}
            <strong>{score === null ? t('notComparable') : `~${score}%`}</strong>
          </span>
          <span className={css.schemaTokens}>~{number(part.tokens)} {t('token')}</span>
        </span>
      </summary>
      <div className={css.matchEvidence}>
        <span>{t('matchedTerms')}</span>
        {score === null ? <span>{t('notComparable')}</span> : matches.length === 0 ? <span>{t('noMatchingTerms')}</span>
          : matches.map((match, index) => <code key={index}>{match.query === match.tool ? match.query : `${match.query} ↔ ${match.tool}`}</code>)}
      </div>
      <pre>{part.text}</pre>
    </details>)}
  </section>
}
