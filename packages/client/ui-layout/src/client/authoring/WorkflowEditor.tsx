/** Visual workflow editor with a draggable node canvas and a property inspector. */
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { Button, IconCheckOutline16, IconChevronLeftOutline14, IconCloseOutline16, IconNewChatOutline16, IconPlusOutline16, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthoringItem, WorkflowEdge, WorkflowNode, WorkflowNodeKind, WorkflowViewport } from '../../authoring-settings.ts'
import type { LayoutKey } from '../locales.ts'
import { workflowRuntimeName, type SubscribeWorkflowDebug, type WorkflowDebugEvent } from './workflow-debug.ts'
import css from './WorkflowPanel.module.css'

const NODE_WIDTH = 190
const NODE_HEIGHT = 112
const CANVAS_WIDTH = 1800
const CANVAS_HEIGHT = 1100
const MIN_ZOOM = .45
const MAX_ZOOM = 1.8
const DEFAULT_VIEWPORT: WorkflowViewport = { x: 24, y: 24, zoom: 1 }

type PaletteGroup = 'trigger' | 'ai' | 'logic' | 'data'
type PendingSource = { id: string; handle?: 'true' | 'false' }

const PALETTE_GROUPS: { key: PaletteGroup; label: LayoutKey; kinds: Exclude<WorkflowNodeKind, 'start' | 'end'>[] }[] = [
  { key: 'trigger', label: 'workflow.palette.trigger', kinds: ['input'] },
  { key: 'ai', label: 'workflow.palette.ai', kinds: ['llm', 'knowledge', 'tool'] },
  { key: 'logic', label: 'workflow.palette.logic', kinds: ['condition', 'template', 'code'] },
  { key: 'data', label: 'workflow.palette.data', kinds: ['http', 'output'] },
]

function nodeLabel(kind: WorkflowNodeKind, t: (key: LayoutKey) => string): string {
  switch (kind) {
    case 'start': return t('workflow.node.start')
    case 'input': return t('workflow.node.input')
    case 'llm': return t('workflow.node.llm')
    case 'tool': return t('workflow.node.tool')
    case 'knowledge': return t('workflow.node.knowledge')
    case 'condition': return t('workflow.node.condition')
    case 'code': return t('workflow.node.code')
    case 'http': return t('workflow.node.http')
    case 'template': return t('workflow.node.template')
    case 'output': return t('workflow.node.output')
    case 'end': return t('workflow.node.end')
  }
}

function nodeId(): string { return `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }

function graphFromSteps(item: AuthoringItem, t: (key: LayoutKey) => string): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  if (item.nodes !== undefined && item.nodes.length > 0) return { nodes: item.nodes, edges: item.edges ?? [] }
  const start: WorkflowNode = { id: nodeId(), kind: 'start', title: t('workflow.node.start'), instructions: '', config: {}, x: 70, y: 270 }
  const steps = item.steps.length === 0 ? [{ title: t('workflow.node.llm'), instructions: item.body }] : item.steps.map((step, index) => ({ title: `${t('workflow.node.llm')} ${index + 1}`, instructions: step }))
  const middle = steps.map((step, index): WorkflowNode => ({ id: nodeId(), kind: 'llm', title: step.title, instructions: step.instructions, config: {}, x: 320 + index * 230, y: 270 }))
  const end: WorkflowNode = { id: nodeId(), kind: 'end', title: t('workflow.node.end'), instructions: '', config: {}, x: 320 + middle.length * 230, y: 270 }
  const nodes = [start, ...middle, end]
  return { nodes, edges: nodes.slice(1).map((target, index) => ({ id: `edge-${nodes[index]?.id}-${target.id}`, source: nodes[index]?.id ?? start.id, target: target.id })) }
}

function viewportOf(item: AuthoringItem): WorkflowViewport {
  const viewport = item.viewport ?? DEFAULT_VIEWPORT
  return { x: Math.max(24, viewport.x), y: Math.max(24, viewport.y), zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.zoom)) }
}

function orderedSteps(nodes: readonly WorkflowNode[]): string[] {
  return nodes.filter(node => node.kind !== 'start' && node.kind !== 'end').sort((a, b) => a.x - b.x || a.y - b.y)
    .map((node) => {
      const config = node.config ?? {}
      const metadata = node.kind === 'tool' && config.tool !== undefined ? `tool=${config.tool.trim()}`
        : node.kind === 'condition' && config.condition !== undefined ? `condition=${config.condition.trim()}`
          : node.kind === 'llm' && config.model !== undefined ? `model=${config.model.trim()}`
            : node.kind === 'input' && config.variable !== undefined ? `input=${config.variable.trim()}`
              : node.kind === 'knowledge' && config.knowledge !== undefined ? `knowledge=${config.knowledge.trim()}`
                : node.kind === 'output' && (config.format !== undefined || config.output !== undefined) ? `format=${(config.format ?? config.output ?? '').trim()}`
                  : node.kind === 'code' && config.language !== undefined ? `language=${config.language.trim()}`
                    : node.kind === 'http' && config.url !== undefined ? `url=${config.url.trim()}`
                      : node.kind === 'template' && config.template !== undefined ? `template=${config.template.trim()}` : ''
      return [node.title.trim(), node.instructions.trim(), metadata].filter(Boolean).join(': ')
    }).filter(Boolean)
}

function validateNodes(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], t: (key: LayoutKey) => string, body = ''): string[] {
  const ids = new Set(nodes.map(node => node.id))
  const messages: string[] = []
  for (const node of nodes) {
    if (node.title.trim() === '') messages.push(`${nodeLabel(node.kind, t)}: ${t('workflow.validation.missingTitle')}`)
    if (['llm', 'tool', 'knowledge', 'condition', 'code', 'http', 'template'].includes(node.kind) && node.instructions.trim() === '' && !(node.kind === 'llm' && body.trim() !== '')) messages.push(`${node.title || nodeLabel(node.kind, t)}: ${t('workflow.validation.missingInstruction')}`)
    if (node.kind === 'tool' && !node.config?.tool?.trim()) messages.push(`${node.title || nodeLabel(node.kind, t)}: ${t('workflow.validation.missingTool')}`)
    if (node.kind === 'condition' && !node.config?.condition?.trim()) messages.push(`${node.title || nodeLabel(node.kind, t)}: ${t('workflow.validation.missingCondition')}`)
  }
  for (const edge of edges) if (!ids.has(edge.source) || !ids.has(edge.target)) messages.push(t('workflow.validation.edge'))
  const start = nodes.find(node => node.kind === 'start')
  if (start !== undefined) {
    const reachable = new Set([start.id])
    let changed = true
    while (changed) {
      changed = false
      for (const edge of edges) {
        if (reachable.has(edge.source) && !reachable.has(edge.target)) {
          reachable.add(edge.target)
          changed = true
        }
      }
    }
    for (const node of nodes) if (node.kind !== 'start' && !reachable.has(node.id)) messages.push(`${node.title || nodeLabel(node.kind, t)}: ${t('workflow.validation.orphan')}`)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    const cycle = (outgoing.get(id) ?? []).some(visit)
    visiting.delete(id)
    visited.add(id)
    return cycle
  }
  if (nodes.some(node => visit(node.id))) messages.push(t('workflow.validation.cycle'))
  return messages
}

function point(node: WorkflowNode, side: 'left' | 'right', handle?: 'true' | 'false'): { x: number; y: number } {
  const y = node.kind === 'condition' && side === 'right' ? node.y + (handle === 'false' ? NODE_HEIGHT - 27 : 27) : node.y + NODE_HEIGHT / 2
  return { x: node.x + (side === 'right' ? NODE_WIDTH : 0), y }
}

export function WorkflowEditor({ initial, writable, save, close, run, subscribeDebug, t }: {
  initial: AuthoringItem
  writable: boolean
  save: (item: AuthoringItem) => Promise<void>
  close: () => void
  run?: (item: AuthoringItem) => Promise<void>
  subscribeDebug?: SubscribeWorkflowDebug
  t: (key: LayoutKey) => string
}) {
  const initialGraph = useMemo(() => graphFromSteps(initial, t), [initial, t])
  const normalizedInitial = useMemo<AuthoringItem>(() => ({
    ...initial,
    nodes: initialGraph.nodes,
    edges: initialGraph.edges,
    viewport: viewportOf(initial),
    steps: orderedSteps(initialGraph.nodes),
  }), [initial, initialGraph])
  const [draft, setDraft] = useState<AuthoringItem>(normalizedInitial)
  const [selectedId, setSelectedId] = useState<string | null>(initialGraph.nodes.find(node => node.kind === 'llm')?.id ?? initialGraph.nodes[0]?.id ?? null)
  const [pendingSource, setPendingSource] = useState<PendingSource | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const [viewport, setViewport] = useState<WorkflowViewport>(() => viewportOf(initial))
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null)
  const [history, setHistory] = useState<AuthoringItem[]>([])
  const [future, setFuture] = useState<AuthoringItem[]>([])
  const [paletteQuery, setPaletteQuery] = useState('')
  const [validation, setValidation] = useState<string[] | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [debugEvents, setDebugEvents] = useState<WorkflowDebugEvent[]>([])
  const [debugOpen, setDebugOpen] = useState(true)
  const debugRunId = useRef<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dirty = JSON.stringify(normalizedInitial) !== JSON.stringify(draft)
  const nodes = draft.nodes ?? []
  const edges = draft.edges ?? []
  const selected = nodes.find(node => node.id === selectedId)

  useEffect(() => {
    if (subscribeDebug === undefined) return
    return subscribeDebug((event) => {
      if (event.workflowName !== workflowRuntimeName(draft.id)) return
      if (event.kind === 'start') {
        debugRunId.current = event.runId
        setDebugEvents([event])
        return
      }
      if (debugRunId.current !== event.runId) return
      setDebugEvents(current => [...current.slice(-99), event])
    })
  }, [subscribeDebug, draft.id])

  const commit = (next: AuthoringItem | ((current: AuthoringItem) => AuthoringItem)): void => {
    const resolved = typeof next === 'function' ? next(draft) : next
    if (JSON.stringify(draft) === JSON.stringify(resolved)) return
    setHistory(previous => [...previous.slice(-39), draft])
    setFuture([])
    setDraft(resolved)
  }

  const updateViewport = (next: WorkflowViewport): void => {
    // Keep the camera inside the scrollable stage; users can still use the viewport scrollbars for the full graph.
    const normalized = { x: Math.max(24, next.x), y: Math.max(24, next.y), zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next.zoom)) }
    setViewport(normalized)
    setDraft(current => ({ ...current, viewport: normalized }))
  }

  const undo = (): void => {
    setHistory((previous) => {
      const prior = previous.at(-1)
      if (prior === undefined) return previous
      setFuture(current => [...current, draft])
      setDraft(prior)
      setViewport(viewportOf(prior))
      return previous.slice(0, -1)
    })
  }

  const redo = (): void => {
    setFuture((previous) => {
      const next = previous.at(-1)
      if (next === undefined) return previous
      setHistory(current => [...current, draft])
      setDraft(next)
      setViewport(viewportOf(next))
      return previous.slice(0, -1)
    })
  }

  useEffect(() => {
    if (drag === null) return
    const move = (event: PointerEvent) => {
      const canvas = canvasRef.current
      if (canvas === null) return
      const rect = canvas.getBoundingClientRect()
      const x = Math.max(16, Math.min(CANVAS_WIDTH - NODE_WIDTH - 16, (event.clientX - rect.left - viewport.x) / viewport.zoom - drag.dx))
      const y = Math.max(16, Math.min(CANVAS_HEIGHT - NODE_HEIGHT - 16, (event.clientY - rect.top - viewport.y) / viewport.zoom - drag.dy))
      setDraft((current) => {
        const nodes = (current.nodes ?? []).map(node => node.id === drag.id ? { ...node, x, y } : node)
        return { ...current, nodes, steps: orderedSteps(nodes) }
      })
    }
    const stop = () => { setDrag(null) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
  }, [drag, viewport])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.target as HTMLElement).closest('input, textarea, select')) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
      if (event.key === 'Escape') setPendingSource(null)
      if (event.key === 'Delete' || event.key === 'Backspace') { if (selectedEdgeId !== null) removeEdge(); else if (selectedId !== null) removeNode(selectedId) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  })

  const updateNodes = (nextNodes: WorkflowNode[]) => commit(current => ({
    ...current,
    nodes: nextNodes,
    steps: orderedSteps(nextNodes),
    updatedAt: Date.now(),
  }))
  const updateConfig = (id: string, patch: WorkflowNode['config']) => updateNodes(nodes.map(node => node.id === id ? { ...node, config: { ...node.config, ...patch } } : node))
  const addNode = (kind: Exclude<WorkflowNodeKind, 'start' | 'end'>, position?: { x: number; y: number }) => {
    const next: WorkflowNode = {
      id: nodeId(),
      kind,
      title: nodeLabel(kind, t),
      instructions: '',
      config: {},
      x: position?.x ?? 260 + (nodes.length % 4) * 220,
      y: position?.y ?? 120 + Math.floor(nodes.length / 4) * 160,
    }
    const last = nodes.find(node => node.kind !== 'end' && node.x === Math.max(...nodes.map(candidate => candidate.x)))
    const nextEdges = last === undefined ? edges : [...edges, { id: `edge-${last.id}-${next.id}`, source: last.id, target: next.id }]
    commit(current => ({ ...current, nodes: [...nodes.filter(node => node.kind !== 'end'), next, ...nodes.filter(node => node.kind === 'end')], edges: nextEdges, steps: orderedSteps([...nodes, next]), updatedAt: Date.now() }))
    setSelectedId(next.id)
  }
  const removeNode = (id: string) => {
    const node = nodes.find(candidate => candidate.id === id)
    if (node === undefined || node.kind === 'start' || node.kind === 'end') return
    const nextNodes = nodes.filter(candidate => candidate.id !== id)
    commit(current => ({
      ...current,
      nodes: nextNodes,
      edges: edges.filter(edge => edge.source !== id && edge.target !== id),
      steps: orderedSteps(nextNodes),
      updatedAt: Date.now(),
    }))
    setSelectedId(nodes.find(candidate => candidate.kind === 'llm' && candidate.id !== id)?.id ?? null)
  }
  const connect = (target: string) => {
    if (pendingSource === null || pendingSource.id === target) return
    if (!edges.some(edge => edge.source === pendingSource.id && edge.target === target && edge.sourceHandle === pendingSource.handle)) {
      commit(current => ({ ...current, edges: [...(current.edges ?? []), { id: `edge-${pendingSource.id}-${target}-${pendingSource.handle ?? 'default'}`, source: pendingSource.id, target, ...(pendingSource.handle === undefined ? {} : { sourceHandle: pendingSource.handle }) }], updatedAt: Date.now() }))
    }
    setPendingSource(null)
  }
  const duplicateSelected = () => {
    if (selected === undefined || selected.kind === 'start' || selected.kind === 'end') return
    const copy: WorkflowNode = { ...selected, id: nodeId(), title: `${selected.title} ${t('workflow.copySuffix')}`, x: Math.min(CANVAS_WIDTH - NODE_WIDTH - 16, selected.x + 40), y: Math.min(CANVAS_HEIGHT - NODE_HEIGHT - 16, selected.y + 40), ...(selected.config === undefined ? {} : { config: { ...selected.config } }) }
    updateNodes([...nodes, copy])
    setSelectedId(copy.id)
    setSelectedEdgeId(null)
  }
  const removeEdge = () => {
    if (selectedEdgeId === null) return
    commit(current => ({ ...current, edges: (current.edges ?? []).filter(edge => edge.id !== selectedEdgeId), updatedAt: Date.now() }))
    setSelectedEdgeId(null)
  }
  const autoLayout = () => {
    const start = nodes.find(node => node.kind === 'start')
    const depths = new Map<string, number>()
    if (start !== undefined) {
      depths.set(start.id, 0)
      const queue = [start.id]
      while (queue.length > 0) {
        const source = queue.shift() as string
        const depth = depths.get(source) ?? 0
        for (const edge of edges.filter(candidate => candidate.source === source)) {
          if ((depths.get(edge.target) ?? -1) < depth + 1) { depths.set(edge.target, depth + 1); queue.push(edge.target) }
        }
      }
    }
    const rows = new Map<number, number>()
    const next = [...nodes].sort((a, b) => (depths.get(a.id) ?? 99) - (depths.get(b.id) ?? 99) || a.y - b.y || a.x - b.x).map((node) => {
      const depth = depths.get(node.id) ?? 0
      const row = rows.get(depth) ?? 0
      rows.set(depth, row + 1)
      return { ...node, x: 70 + depth * 250, y: 100 + row * 160 }
    })
    updateNodes(next)
  }
  const back = () => { if (!dirty || window.confirm(t('workflow.discard'))) close() }
  const submit = async () => {
    if (!writable || saving || !draft.title.trim()) return
    const issues = validateNodes(nodes, edges, t, draft.body)
    setValidation(issues)
    setSaving(true)
    setError(false)
    try { await save({ ...draft, title: draft.title.trim(), steps: orderedSteps(draft.nodes ?? []), updatedAt: Date.now() }); close() }
    catch { setError(true) }
    finally { setSaving(false) }
  }
  const testRun = async () => {
    if (run === undefined || !writable || saving || testing || !draft.title.trim()) return
    const issues = validateNodes(nodes, edges, t, draft.body)
    setValidation(issues)
    if (issues.length > 0) return
    setTesting(true)
    setError(false)
    try { await run({ ...draft, title: draft.title.trim(), steps: orderedSteps(draft.nodes ?? []), updatedAt: Date.now() }) }
    catch { setError(true) }
    finally { setTesting(false) }
  }
  const startDrag = (event: ReactPointerEvent<HTMLElement>, node: WorkflowNode) => {
    if ((event.target as HTMLElement).closest('button, input, textarea')) return
    const canvas = canvasRef.current
    if (canvas === null) return
    const rect = canvas.getBoundingClientRect()
    setSelectedId(node.id)
    setDrag({
      id: node.id,
      dx: (event.clientX - rect.left + canvas.scrollLeft - viewport.x) / viewport.zoom - node.x,
      dy: (event.clientY - rect.top + canvas.scrollTop - viewport.y) / viewport.zoom - node.y,
    })
  }
  const startPan = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('article, button, input, textarea, select')) return
    setPan({ x: event.clientX - viewport.x, y: event.clientY - viewport.y })
  }
  const dropNode = (event: ReactDragEvent<HTMLElement>): void => {
    event.preventDefault()
    const kind = event.dataTransfer.getData('application/x-workflow-node') as Exclude<WorkflowNodeKind, 'start' | 'end'>
    if (!PALETTE_GROUPS.some(group => group.kinds.includes(kind))) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    addNode(kind, {
      x: Math.max(16, (event.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0) - viewport.x) / viewport.zoom - NODE_WIDTH / 2),
      y: Math.max(16, (event.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0) - viewport.y) / viewport.zoom - NODE_HEIGHT / 2),
    })
  }
  const handleWheel = (event: ReactWheelEvent<HTMLElement>): void => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const factor = Math.exp(-event.deltaY * .001)
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.zoom * factor))
    const focusX = event.clientX - rect.left
    const focusY = event.clientY - rect.top
    updateViewport({
      x: focusX - (focusX - viewport.x) * nextZoom / viewport.zoom,
      y: focusY - (focusY - viewport.y) * nextZoom / viewport.zoom,
      zoom: nextZoom,
    })
  }
  useEffect(() => {
    if (pan === null) return
    const move = (event: PointerEvent): void => updateViewport({ ...viewport, x: event.clientX - pan.x, y: event.clientY - pan.y })
    const stop = (): void => setPan(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
  }, [pan, viewport])
  const fitView = (): void => {
    if (nodes.length === 0) return
    const minX = Math.min(...nodes.map(node => node.x)); const minY = Math.min(...nodes.map(node => node.y))
    const maxX = Math.max(...nodes.map(node => node.x + NODE_WIDTH)); const maxY = Math.max(...nodes.map(node => node.y + NODE_HEIGHT))
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((rect.width - 80) / (maxX - minX), (rect.height - 80) / (maxY - minY))))
    updateViewport({
      x: Math.max(24, (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom),
      y: Math.max(24, (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom),
      zoom,
    })
  }
  const filteredGroups = PALETTE_GROUPS
    .map(group => ({
      ...group,
      kinds: group.kinds.filter(kind => nodeLabel(kind, t).toLowerCase().includes(paletteQuery.trim().toLowerCase())),
    }))
    .filter(group => group.kinds.length > 0)
  return <main className={css.editorPage}>
    <div className={css.visualEditor}>
      <header className={css.visualHeader}>
        <Button icon={<IconChevronLeftOutline14 />} disabled={saving} onClick={back}>{t('workflow.back')}</Button>
        <div className={css.visualTitle}><h1>{t('workflow.edit')}</h1><span>{draft.title || t('name')}</span></div>
        <div className={css.visualHeaderActions}><span className={`${css.saveState} ${dirty ? css.saveStateDirty : ''}`}><span className={css.saveDot} />{t(dirty ? 'workflow.unsaved' : 'workflow.saved')}</span><Button type="button" variant="outline" disabled={history.length === 0 || saving || testing} onClick={undo} aria-label={t('workflow.undo')}>↶</Button><Button type="button" variant="outline" disabled={future.length === 0 || saving || testing} onClick={redo} aria-label={t('workflow.redo')}>↷</Button><Button type="button" variant="outline" disabled={saving || testing} onClick={() => { setValidation(validateNodes(nodes, edges, t)) }}>{t('workflow.validate')}</Button>{run !== undefined && <Button type="button" variant="outline" icon={<IconNewChatOutline16 />} disabled={!writable || saving || testing || !draft.title.trim()} onClick={() => { void testRun() }}>{t(testing ? 'workflow.testing' : 'workflow.testRun')}</Button>}<Button type="button" variant="primary" icon={<IconCheckOutline16 />} disabled={!writable || saving || testing || !draft.title.trim()} onClick={() => { void submit() }}>{t(saving ? 'workflow.saving' : 'save')}</Button></div>
      </header>
      <div className={css.visualMeta}>
        <label className={css.compactField}><span>{t('name')}</span><input value={draft.title} onChange={(event) => { commit(current => ({ ...current, title: event.target.value })) }} /></label>
        <label className={css.compactField}><span>{t('description')}</span><input value={draft.description} onChange={(event) => { commit(current => ({ ...current, description: event.target.value })) }} /></label>
        <label className={css.compactToggle}><input type="checkbox" checked={draft.enabled} onChange={(event) => { commit(current => ({ ...current, enabled: event.target.checked })) }} />{t('enabled')}</label>
      </div>
      {error && <p role="alert" className={css.error}>{t('workflow.saveError')}</p>}
      <div className={css.visualLayout}>
        <aside className={css.palette} aria-label={t('workflow.palette')}>
          <h2>{t('workflow.palette')}</h2>
          <label className={css.paletteSearch}><IconSearchOutline16 size={14} /><input type="search" value={paletteQuery} onChange={(event) => { setPaletteQuery(event.target.value) }} placeholder={t('workflow.searchNodes')} aria-label={t('workflow.searchNodes')} /></label>
          {filteredGroups.map(group => <div className={css.paletteGroup} key={group.key}><h3>{t(group.label)}</h3>{group.kinds.map(kind => <button type="button" draggable className={css.paletteButton} key={kind} onDragStart={(event) => { event.dataTransfer.setData('application/x-workflow-node', kind); event.dataTransfer.effectAllowed = 'copy' }} onClick={() => { addNode(kind) }}><IconPlusOutline16 size={15} /><span>{nodeLabel(kind, t)}</span></button>)}</div>)}
          <p className={css.edgeHint}>{t('workflow.edgeHint')}</p>
        </aside>
        <section className={css.canvasViewport} aria-label={t('workflow.canvas')} ref={canvasRef} onPointerDown={startPan} onWheel={handleWheel} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={dropNode}>
          <div className={css.canvasToolbar}><button type="button" onClick={() => { updateViewport({ ...viewport, zoom: Math.min(MAX_ZOOM, viewport.zoom + .1) }) }} aria-label={t('workflow.zoomIn')}>+</button><span>{Math.round(viewport.zoom * 100)}%</span><button type="button" onClick={() => { updateViewport({ ...viewport, zoom: Math.max(MIN_ZOOM, viewport.zoom - .1) }) }} aria-label={t('workflow.zoomOut')}>−</button><button type="button" onClick={fitView} aria-label={t('workflow.fit')}>⌖</button><button type="button" onClick={autoLayout} aria-label={t('workflow.autoLayout')}>⌗</button>{selectedEdgeId !== null && <button type="button" onClick={removeEdge} aria-label={t('workflow.deleteEdge')}>×</button>}</div>
          <div className={css.canvasSurface} style={{ width: CANVAS_WIDTH * viewport.zoom, height: CANVAS_HEIGHT * viewport.zoom, transform: `translate(${viewport.x}px, ${viewport.y}px)`, transformOrigin: 'top left' }}>
            <div className={css.canvasScaled} style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${viewport.zoom})` }}>
              <svg className={css.edgeLayer} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} aria-hidden="true">
                <defs><marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" /></marker></defs>
                {edges.map((edge) => {
                  const source = nodes.find(node => node.id === edge.source)
                  const target = nodes.find(node => node.id === edge.target)
                  if (source === undefined || target === undefined) return null
                  const from = point(source, 'right', edge.sourceHandle); const to = point(target, 'left'); const bend = Math.max(from.x + 48, (from.x + to.x) / 2)
                  return <g key={edge.id} className={selectedEdgeId === edge.id ? css.edgeSelected : undefined} onClick={() => { setSelectedEdgeId(edge.id); setSelectedId(null) }}><path d={`M ${from.x} ${from.y} C ${bend} ${from.y}, ${bend} ${to.y}, ${to.x} ${to.y}`} markerEnd="url(#workflow-arrow)" /><text x={from.x + 8} y={from.y - 7} className={css.edgeLabel}>{edge.sourceHandle === 'true' ? 'true' : edge.sourceHandle === 'false' ? 'false' : ''}</text></g>
                })}
              </svg>
              {nodes.map(node => <article key={node.id} className={`${css.canvasNode} ${css[`node_${node.kind}`]}${selectedId === node.id ? ` ${css.nodeSelected}` : ''}`} style={{ left: node.x, top: node.y }} onPointerDown={(event) => { startDrag(event, node) }}>
                <div className={css.nodeHeader}><span className={css.nodeType}>{nodeLabel(node.kind, t)}</span><button type="button" className={css.nodeDelete} disabled={node.kind === 'start' || node.kind === 'end'} title={t('workflow.removeNode')} onClick={() => { removeNode(node.id) }}><IconCloseOutline16 size={13} /></button></div>
                <button type="button" className={css.nodeBody} onClick={() => { setSelectedId(node.id) }}><strong>{node.title}</strong><span>{node.instructions || t('workflow.selectNode')}</span></button>
                {node.kind !== 'start' && <button type="button" className={css.nodeHandleLeft} title={t('workflow.connectTo')} aria-label={`${t('workflow.connectTo')} ${node.title}`} onClick={() => { connect(node.id) }} />}
                {node.kind === 'condition' ? <><button type="button" className={`${css.nodeHandleRight} ${css.nodeHandleTrue}`} title={`${t('workflow.connectFrom')} true`} aria-label={`${t('workflow.connectFrom')} ${node.title} true`} onClick={() => { setPendingSource({ id: node.id, handle: 'true' }) }} data-active={pendingSource?.id === node.id && pendingSource.handle === 'true' || undefined} /><button type="button" className={`${css.nodeHandleRight} ${css.nodeHandleFalse}`} title={`${t('workflow.connectFrom')} false`} aria-label={`${t('workflow.connectFrom')} ${node.title} false`} onClick={() => { setPendingSource({ id: node.id, handle: 'false' }) }} data-active={pendingSource?.id === node.id && pendingSource.handle === 'false' || undefined} /></> : node.kind !== 'end' && <button type="button" className={css.nodeHandleRight} title={t('workflow.connectFrom')} aria-label={`${t('workflow.connectFrom')} ${node.title}`} onClick={() => { setPendingSource({ id: node.id }) }} data-active={pendingSource?.id === node.id || undefined} />}
              </article>)}
            </div>
          </div>
          <div className={css.minimap} aria-label={t('workflow.minimap')}>
            <div className={css.minimapViewport} style={{ left: `${Math.max(0, Math.min(100 - 18, (-viewport.x / viewport.zoom) / CANVAS_WIDTH * 100))}%`, top: `${Math.max(0, Math.min(100 - 18, (-viewport.y / viewport.zoom) / CANVAS_HEIGHT * 100))}%` }} />
            {nodes.map(node => <span key={node.id} className={`${css.minimapNode} ${css[`minimap_${node.kind}`]}`} style={{ left: `${node.x / CANVAS_WIDTH * 100}%`, top: `${node.y / CANVAS_HEIGHT * 100}%` }} />)}
          </div>
          <div className={css.canvasStatus}><span>{t('workflow.canvasReady')}</span><span>{t('workflow.stats').replace('{nodes}', String(nodes.length)).replace('{edges}', String(edges.length))}</span>{pendingSource !== null && <strong>{t('workflow.connectionMode')}</strong>}</div>
        </section>
        <aside className={css.inspector} aria-label={t('workflow.selectNode')}>
          <h2>{selected === undefined ? t('workflow.selectNode') : selected.title}</h2>
          {selected === undefined ? <p className={css.inspectorEmpty}>{selectedEdgeId !== null ? t('workflow.edgeSelected') : t('workflow.noSelection')}</p> : <>
            <span className={css.inspectorType}>{nodeLabel(selected.kind, t)}</span>
            <label className={css.field}><span>{t('workflow.nodeTitle')}</span><input value={selected.title} onChange={(event) => { updateNodes(nodes.map(node => node.id === selected.id ? { ...node, title: event.target.value } : node)) }} /></label>
            <label className={css.field}><span>{t('workflow.nodeInstructions')}</span><textarea value={selected.instructions} onChange={(event) => { updateNodes(nodes.map(node => node.id === selected.id ? { ...node, instructions: event.target.value } : node)) }} /></label>
            {selected.kind === 'input' && <label className={css.field}><span>{t('workflow.nodeVariable')}</span><input value={selected.config?.variable ?? ''} placeholder={t('workflow.nodeVariablePlaceholder')} onChange={(event) => { updateConfig(selected.id, { variable: event.target.value }) }} /></label>}
            {selected.kind === 'llm' && <label className={css.field}><span>{t('workflow.nodeModel')}</span><input value={selected.config?.model ?? ''} placeholder={t('workflow.nodeModelPlaceholder')} onChange={(event) => { updateConfig(selected.id, { model: event.target.value }) }} /></label>}
            {selected.kind === 'tool' && <label className={css.field}><span>{t('workflow.node.tool')}</span><input value={selected.config?.tool ?? ''} onChange={(event) => { updateConfig(selected.id, { tool: event.target.value }) }} /></label>}
            {selected.kind === 'knowledge' && <label className={css.field}><span>{t('workflow.nodeKnowledge')}</span><input value={selected.config?.knowledge ?? ''} placeholder={t('workflow.nodeKnowledgePlaceholder')} onChange={(event) => { updateConfig(selected.id, { knowledge: event.target.value }) }} /></label>}
            {selected.kind === 'condition' && <label className={css.field}><span>{t('workflow.node.condition')}</span><input value={selected.config?.condition ?? ''} onChange={(event) => { updateConfig(selected.id, { condition: event.target.value }) }} /></label>}
            {selected.kind === 'code' && <label className={css.field}><span>{t('workflow.nodeLanguage')}</span><input value={selected.config?.language ?? ''} placeholder={t('workflow.nodeLanguagePlaceholder')} onChange={(event) => { updateConfig(selected.id, { language: event.target.value }) }} /></label>}
            {selected.kind === 'http' && <><label className={css.field}><span>{t('workflow.nodeUrl')}</span><input value={selected.config?.url ?? ''} placeholder={t('workflow.nodeUrlPlaceholder')} onChange={(event) => { updateConfig(selected.id, { url: event.target.value }) }} /></label><label className={css.field}><span>{t('workflow.nodeMethod')}</span><select value={selected.config?.method ?? 'GET'} onChange={(event) => { updateConfig(selected.id, { method: event.target.value }) }}><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label></>}
            {selected.kind === 'template' && <label className={css.field}><span>{t('workflow.nodeTemplate')}</span><textarea value={selected.config?.template ?? ''} placeholder={t('workflow.nodeTemplatePlaceholder')} onChange={(event) => { updateConfig(selected.id, { template: event.target.value }) }} /></label>}
            {selected.kind === 'output' && <><label className={css.field}><span>{t('workflow.nodeOutput')}</span><textarea value={selected.config?.output ?? ''} onChange={(event) => { updateConfig(selected.id, { output: event.target.value }) }} /></label><label className={css.field}><span>{t('workflow.nodeFormat')}</span><input value={selected.config?.format ?? ''} placeholder={t('workflow.nodeFormatPlaceholder')} onChange={(event) => { updateConfig(selected.id, { format: event.target.value }) }} /></label></>}
            <Button size="sm" icon={<IconPlusOutline16 />} disabled={selected.kind === 'start' || selected.kind === 'end'} onClick={duplicateSelected}>{t('workflow.copy')}</Button>
          </>}
          <label className={css.field}><span>{t('workflow.instructions')}</span><textarea aria-label={t('workflow.instructions')} value={draft.body} onChange={(event) => { commit(current => ({ ...current, body: event.target.value })) }} /></label>
          {validation !== null && <div className={css.validation} role="status"><strong>{validation.length === 0 ? t('workflow.valid') : t('workflow.invalid').replace('{count}', String(validation.length))}</strong>{validation.length > 0 && <ul>{validation.map((message, index) => <li key={index}>{message}</li>)}</ul>}</div>}
          {debugOpen && <section className={css.debugDock} aria-label={t('workflow.debugTitle')}><div className={css.debugHeader}><h3>{t('workflow.debugTitle')}</h3><span>{debugEvents.length > 0 ? t('workflow.debugLive') : t('workflow.debugIdle')}</span><button type="button" onClick={() => { setDebugEvents([]) }} aria-label={t('workflow.clearDebug')}>×</button></div>{debugEvents.length === 0 ? <p className={css.debugEmpty}>{t('workflow.debugEmpty')}</p> : <ol className={css.debugList}>{debugEvents.slice(-12).map((event, index) => <li key={`${event.at}-${index}`} className={css[`debug_${event.kind}`]}><span className={css.debugTime}>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span>{event.kind === 'phase' ? event.title : event.kind === 'log' ? event.message : event.kind === 'agent-start' ? event.label : event.kind === 'agent-end' ? `${event.label} · ${event.outcome}` : event.kind === 'end' ? event.stopReason : t('workflow.debugStarted')}</span></li>)}</ol>}</section>}
          <button type="button" className={css.debugToggle} onClick={() => { setDebugOpen(value => !value) }}>{t(debugOpen ? 'workflow.hideDebug' : 'workflow.showDebug')}</button>
        </aside>
      </div>
    </div>
  </main>
}
