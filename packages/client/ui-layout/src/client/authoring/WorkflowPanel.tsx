/** Template library and editing console for user-authored workflows. */
import { useMemo, useRef, useState } from 'react'
import { Button, Input, IconBrowseOutline16, IconCloseOutline16, IconCodeOutline16, IconEditOutline16, IconNewChatOutline16, IconPlusOutline16, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { isWorkflowPublished, latestWorkflowVersion, type AuthoringItem, type WorkflowEdge, type WorkflowNode, type WorkflowNodeKind } from '../../authoring-settings.ts'
import { BUILTIN_WORKFLOWS, type BuiltinWorkflow } from '../../builtin-workflows.ts'
import type { LayoutKey } from '../locales.ts'
import { WorkflowEditor } from './WorkflowEditor.tsx'
import type { SubscribeWorkflowDebug, WorkflowRunControls, WorkflowRunInput, WorkflowRunStart, WorkflowRunStartHandler } from './workflow-debug.ts'
import { parseWorkflowExport } from '../../workflow-io.ts'
import css from './WorkflowPanel.module.css'

type Source = 'all' | 'templates' | 'mine'
type WorkflowCard = {
  name: string
  title: string
  description: string
  body: string
  steps: readonly string[]
  nodes?: number
  edges?: number
  updatedAt?: number
  item?: AuthoringItem
  template?: BuiltinWorkflow
}

function workflowId(name: string): string { return `builtin-workflow-${name}` }
function cssClass(value: string | undefined): string { return value ?? '' }

function blankWorkflow(): AuthoringItem {
  return { id: `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: '', description: '', enabled: true, body: '', steps: [], workflowStatus: 'draft', version: 0, updatedAt: 0 }
}

function templateGraph(card: WorkflowCard, t: (key: LayoutKey) => string): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const kinds: WorkflowNodeKind[] = card.name === 'research-brief'
    ? ['start', 'input', 'knowledge', 'llm', 'output', 'end']
    : card.name === 'content-review'
      ? ['start', 'input', 'llm', 'condition', 'output', 'template', 'end']
      : ['start', 'input', 'llm', 'output', 'end']
  const nodes = kinds.map((kind, index): WorkflowNode => ({
    id: `node-${card.name}-${kind}-${index}`,
    kind,
    title: nodeTitle(kind, t, index),
    instructions: kind === 'llm'
      ? card.body
      : kind === 'input'
        ? card.steps[0] ?? ''
        : kind === 'knowledge'
          ? card.steps[1] ?? card.description
          : kind === 'condition'
            ? card.steps[1] ?? card.description
            : kind === 'output'
              ? card.steps.at(-1) ?? ''
              : kind === 'template'
                ? card.steps.at(-1) ?? ''
                : '',
    config: kind === 'knowledge'
      ? { knowledge: t('workflow.nodeKnowledgePlaceholder') }
      : kind === 'condition'
        ? { condition: card.steps[1] ?? '判断输入是否满足要求' }
        : kind === 'template'
          ? { template: '{{input}}' }
          : {},
    x: 70 + index * 220,
    y: kind === 'condition' ? 190 : 270,
  }))
  if (card.name !== 'content-review') {
    return {
      nodes,
      edges: nodes.slice(1).map((target, index) => ({
        id: `edge-${nodes[index]?.id}-${target.id}`,
        source: nodes[index]?.id ?? nodes[0]?.id ?? '',
        target: target.id,
      })),
    }
  }
  const start = nodes[0]
  const input = nodes[1]
  const model = nodes[2]
  const condition = nodes[3]
  const accepted = nodes[4]
  const revise = nodes[5]
  const end = nodes[6]
  if (start === undefined || input === undefined || model === undefined || condition === undefined
    || accepted === undefined || revise === undefined || end === undefined) return { nodes, edges: [] }
  return {
    nodes,
    edges: [
      { id: `edge-${start.id}-${input.id}`, source: start.id, target: input.id },
      { id: `edge-${input.id}-${model.id}`, source: input.id, target: model.id },
      { id: `edge-${model.id}-${condition.id}`, source: model.id, target: condition.id },
      { id: `edge-${condition.id}-${accepted.id}`, source: condition.id, target: accepted.id, sourceHandle: 'true' },
      { id: `edge-${condition.id}-${revise.id}`, source: condition.id, target: revise.id, sourceHandle: 'false' },
      { id: `edge-${accepted.id}-${end.id}`, source: accepted.id, target: end.id },
      { id: `edge-${revise.id}-${end.id}`, source: revise.id, target: end.id },
    ],
  }
}

function nodeTitle(kind: WorkflowNodeKind, t: (key: LayoutKey) => string, index: number): string {
  const labels: Record<WorkflowNodeKind, LayoutKey> = {
    start: 'workflow.node.start', input: 'workflow.node.input', llm: 'workflow.node.llm', tool: 'workflow.node.tool',
    knowledge: 'workflow.node.knowledge', condition: 'workflow.node.condition', code: 'workflow.node.code', http: 'workflow.node.http', template: 'workflow.node.template', output: 'workflow.node.output', end: 'workflow.node.end',
  }
  return `${t(labels[kind])}${kind === 'start' || kind === 'end' ? '' : ` ${index}`}`
}

export function WorkflowPanel({ items, writable, save, remove, invoke, run, runControls, subscribeDebug, t }: {
  items: readonly AuthoringItem[]
  writable: boolean
  save: (item: AuthoringItem) => Promise<void>
  remove?: (id: string) => Promise<void>
  invoke: (name: string, title: string) => Promise<void>
  /** Optional direct run path; falls back to opening a prepared chat draft. */
  run?: WorkflowRunStartHandler
  runControls?: WorkflowRunControls
  subscribeDebug?: SubscribeWorkflowDebug
  t: (key: LayoutKey) => string
}) {
  const [source, setSource] = useState<Source>('all')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<AuthoringItem | null>(null)
  const [importing, setImporting] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const catalog = useMemo<WorkflowCard[]>(() => [
    ...BUILTIN_WORKFLOWS.map((template) => {
      const item = items.find(candidate => candidate.id === workflowId(template.name))
      return {
        name: template.name,
        title: item?.title ?? t(template.title),
        description: item?.description ?? t(template.description),
        body: item?.body ?? t(template.body),
        steps: item?.steps ?? template.steps.map(t),
        ...(item?.nodes === undefined ? {} : { nodes: item.nodes.length }),
        ...(item?.edges === undefined ? {} : { edges: item.edges.length }),
        ...(item?.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
        template,
        ...(item === undefined ? {} : { item }),
      }
    }),
    ...items.filter(item => !item.id.startsWith('builtin-workflow-')).map(item => ({
      name: item.id,
      title: item.title,
      description: item.description,
      body: item.body,
      steps: item.steps,
      ...(item.nodes === undefined ? {} : { nodes: item.nodes.length }),
      ...(item.edges === undefined ? {} : { edges: item.edges.length }),
      updatedAt: item.updatedAt,
      item,
    })),
  ], [items, t])
  const needle = query.trim().toLocaleLowerCase()
  const shown = catalog.filter(card => (source === 'all' || (source === 'templates' ? card.template !== undefined : card.item !== undefined))
    && [card.name, card.title, card.description].join(' ').toLocaleLowerCase().includes(needle))
  const importTemplate = async (card: WorkflowCard): Promise<void> => {
    if (card.template === undefined || !writable || importing !== null) return
    setImporting(card.name)
    setError(false)
    try {
      const graph = templateGraph(card, t)
      const publishedAt = Date.now()
      const imported: AuthoringItem = {
        id: workflowId(card.template.name),
        title: card.title,
        description: card.description,
        body: card.body,
        steps: [...card.steps],
        enabled: card.item?.enabled ?? true,
        nodes: graph.nodes,
        edges: graph.edges,
        workflowStatus: 'published',
        version: 1,
        updatedAt: publishedAt,
      }
      imported.versions = [{
        version: 1,
        publishedAt,
        title: imported.title,
        description: imported.description,
        body: imported.body,
        steps: imported.steps,
        nodes: graph.nodes,
        edges: graph.edges,
      }]
      await save({
        ...imported,
      })
    } catch { setError(true) } finally { setImporting(null) }
  }
  const useWorkflow = async (card: WorkflowCard): Promise<void> => {
    if (opening !== null || card.item?.enabled === false) return
    setOpening(card.name)
    setError(false)
    try { await invoke(card.item?.id ?? workflowId(card.name), card.title) } catch { setError(true) } finally { setOpening(null) }
  }
  const runWorkflow = async (item: AuthoringItem, input: WorkflowRunInput = { text: '', mode: 'text' }): Promise<WorkflowRunStart | void> => {
    await save(item)
    if (run !== undefined) return input.text === '' && input.mode === 'text' && input.timeoutMs === undefined ? run(item) : run(item, input)
    await invoke(item.id, item.title)
  }
  const copyWorkflow = async (card: WorkflowCard): Promise<void> => {
    if (card.item === undefined || !writable || importing !== null) return
    setImporting(card.name)
    setError(false)
    try {
      const id = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const ids = new Map((card.item.nodes ?? []).map(node => [node.id, `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`]))
      const copiedNodes = card.item.nodes === undefined ? undefined : card.item.nodes.map(node => ({
        ...node,
        id: ids.get(node.id) ?? node.id,
      }))
      const copiedEdges = card.item.edges === undefined ? undefined : card.item.edges.map(edge => ({
        ...edge,
        id: `edge-${ids.get(edge.source) ?? edge.source}-${ids.get(edge.target) ?? edge.target}`,
        source: ids.get(edge.source) ?? edge.source,
        target: ids.get(edge.target) ?? edge.target,
      }))
      await save({ ...card.item, id, title: `${card.item.title} ${t('workflow.copySuffix')}`, ...(copiedNodes === undefined ? {} : { nodes: copiedNodes }), ...(copiedEdges === undefined ? {} : { edges: copiedEdges }), updatedAt: Date.now() })
    } catch { setError(true) } finally { setImporting(null) }
  }
  const deleteWorkflow = async (card: WorkflowCard): Promise<void> => {
    if (card.item === undefined || remove === undefined || !writable || !window.confirm(t('workflow.deleteConfirm'))) return
    setError(false)
    try { await remove(card.item.id) } catch { setError(true) }
  }
  const importWorkflowFile = async (file: File): Promise<void> => {
    if (!writable || importing !== null) return
    setImporting('file')
    setError(false)
    try {
      const name = file.name.toLowerCase()
      const format = name.endsWith('.json') ? 'json' as const : name.endsWith('.yaml') || name.endsWith('.yml') ? 'yaml' as const : undefined
      if (format === undefined) throw new Error('Unsupported workflow file format')
      const imported = parseWorkflowExport(await file.text(), format)
      await save(imported)
    } catch { setError(true) } finally { setImporting(null) }
  }
  if (draft !== null) {
    return <WorkflowEditor initial={draft} writable={writable} save={save} run={runWorkflow} {...runControls === undefined ? {} : { runControls }}
      {...subscribeDebug === undefined ? {} : { subscribeDebug }} close={() => { setDraft(null) }} t={t} />
  }
  return <main className={css.page}>
    <div className={css.inner}>
      <header className={css.header}>
        <div className={css.heading}><IconCodeOutline16 size={28} /><div><h1>{t('workflow.consoleTitle')}</h1><p>{t('workflow.consoleSubtitle')}</p></div><span className={css.total}>{catalog.length}</span></div>
        <div className={css.headerActions}>
          <Button variant="outline" icon={<IconBrowseOutline16 />} disabled={!writable || importing !== null} onClick={() => { importInputRef.current?.click() }}>{t(importing === 'file' ? 'workflow.importingFile' : 'workflow.importFile')}</Button>
          <input ref={importInputRef} className={css.fileInput} type="file" accept=".json,.yaml,.yml,application/json,text/yaml" aria-label={t('workflow.importFile')} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file !== undefined) void importWorkflowFile(file) }} />
          <Button variant="primary" icon={<IconPlusOutline16 />} disabled={!writable} onClick={() => { setDraft(blankWorkflow()) }}>{t('create')}</Button>
        </div>
      </header>
      <div className={css.toolbar}>
        <div className={css.sources} role="group" aria-label={t('workflow.consoleTitle')}>
          {(['all', 'templates', 'mine'] as const).map(value => <button type="button" className={css.source} aria-pressed={source === value} key={value} onClick={() => { setSource(value) }}>
            {t(value === 'all' ? 'skill.all' : value === 'templates' ? 'workflow.templates' : 'workflow.mine')}<span>{value === 'all' ? catalog.length : value === 'templates' ? BUILTIN_WORKFLOWS.length : items.length}</span>
          </button>)}
        </div>
        <Input className={cssClass(css.search)} icon={<IconSearchOutline16 />} type="search" aria-label={t('skill.search')} placeholder={t('skill.search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
      </div>
      {error && <p role="alert" className={css.error}>{t('workflow.saveError')}</p>}
      <section className={css.grid} aria-label={t('workflow.consoleTitle')}>
        {shown.map((card) => {
          const imported = card.item !== undefined
          const liveVersion = card.item === undefined ? undefined : latestWorkflowVersion(card.item)
          const status = card.item?.workflowStatus === 'draft' && liveVersion !== undefined
            ? t('workflow.draftWithPublished').replace('{version}', String(liveVersion.version))
            : card.item !== undefined && isWorkflowPublished(card.item) ? t('workflow.published') : t('workflow.draft')
          return <article className={css.card} key={card.name}>
            <div className={css.cardTop}><span className={css.icon}><IconCodeOutline16 size={22} /></span><span className={css.badge}>{imported ? status : t('workflow.templates')}</span></div>
            <h2>{card.title}</h2><p className={css.description}>{card.description}</p>
            {card.item !== undefined && <p className={css.cardMeta}>{t('workflow.stats').replace('{nodes}', String(card.nodes ?? card.steps.length + 2)).replace('{edges}', String(card.edges ?? Math.max(0, card.steps.length + 1)))}{card.item.version !== undefined ? ` · ${t('workflow.version').replace('{version}', String(card.item.version))}` : ''}{card.updatedAt !== undefined && card.updatedAt > 0 ? ` · ${t('workflow.updated').replace('{date}', new Date(card.updatedAt).toLocaleDateString())}` : ''}</p>}
            <ol className={css.steps}>{card.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
            <div className={css.cardActions}>
              {imported && card.item !== undefined && <><Button size="sm" icon={<IconEditOutline16 />} disabled={!writable} onClick={() => { if (card.item !== undefined) setDraft(card.item) }}>{t('workflow.edit')}</Button><Button size="sm" icon={<IconPlusOutline16 />} disabled={!writable || importing !== null} onClick={() => { void copyWorkflow(card) }}>{t('workflow.copy')}</Button>{remove !== undefined && <Button size="sm" icon={<IconCloseOutline16 />} disabled={!writable} onClick={() => { void deleteWorkflow(card) }} title={t('workflow.delete')}>{t('workflow.delete')}</Button>}</>}
              {imported ? <Button size="sm" variant="outline" icon={<IconNewChatOutline16 />} disabled={!card.item?.enabled || !isWorkflowPublished(card.item!) || opening !== null} onClick={() => { void useWorkflow(card) }}>{t(opening === card.name ? 'workflow.opening' : 'workflow.use')}</Button>
                : <Button size="sm" variant="primary" icon={<IconPlusOutline16 />} disabled={!writable || importing !== null} onClick={() => { void importTemplate(card) }}>{t(importing === card.name ? 'skill.importing' : 'workflow.import')}</Button>}
            </div>
          </article>
        })}
      </section>
      {shown.length === 0 && <div className={css.empty}><h2>{t(source === 'mine' ? 'workflow.noMine' : 'workflow.empty')}</h2><Button onClick={() => { setSource('all'); setQuery('') }}>{t('skill.reset')}</Button></div>}
    </div>
  </main>
}
