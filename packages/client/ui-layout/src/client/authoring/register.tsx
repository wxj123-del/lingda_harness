import { useEffect, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ISession, ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkflowScheduleRecord } from '@deepseek-ai/dsh-schedule/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MainPanelId } from '../service.ts'
import type { createLayoutStore } from '../stores.ts'
import type { AuthoringItem, AuthoringSettings, KnowledgeDocument } from '../../authoring-settings.ts'
import type { NavigationPanelMetadata } from '../index.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { IconApiOutline14, IconBranchOutline16, IconCordisPluginOutline14, IconDatabaseOutline16, IconEditOutline16, IconSkillOutline16, IconPlusOutline16, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { en, zh } from '../locales.ts'
import css from './AuthoringPanel.module.css'
import { StepsEditor } from './StepsEditor.tsx'
import { SkillsPanel } from './SkillsPanel.tsx'
import { WorkflowPanel } from './WorkflowPanel.tsx'
import { ToolsPanel, type ToolsPanelProps } from './ToolsPanel.tsx'
import { KnowledgePanel, type KnowledgePanelProps } from './KnowledgePanel.tsx'
import {
  KnowledgeConversationControl,
  type KnowledgeConversationControlInjected,
} from './KnowledgeConversationControl.tsx'
import type {
  KnowledgeGenerateRequest,
  KnowledgeGenerateValue,
  WorkflowGenerateRequest,
  WorkflowGenerateValue,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** The authoring Remote namespace as the generated Typert contract exposes it. */
interface AuthoringAssistantRemote {
  generateWorkflow: (request: WorkflowGenerateRequest, signal?: AbortSignal) => Promise<RemoteResult<WorkflowGenerateValue>>
  generateKnowledge: (request: KnowledgeGenerateRequest, signal?: AbortSignal) => Promise<RemoteResult<KnowledgeGenerateValue>>
}
import { runtimeToolName } from '../../runtime-tool-name.ts'
import type { SubscribeWorkflowDebug, WorkflowCredentialControls, WorkflowRunControls, WorkflowRunInput, WorkflowRunStart, WorkflowRunStartHandler, WorkflowRunView, WorkflowScheduleControls, WorkflowScheduleView } from './workflow-debug.ts'
import { compileWorkflow } from '../../workflow-compile.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { layout: keyof typeof zh }
}

type AuthoringKind = 'knowledge' | 'workflow' | 'skill' | 'tool'
type AuthoringField = keyof Pick<AuthoringSettings, 'knowledge' | 'workflows' | 'skills' | 'tools'>

const PANEL_IDS = {
  knowledge: 'authoring-knowledge',
  workflow: 'authoring-workflow',
  skill: 'authoring-skill',
  tool: 'authoring-tool',
} as const

const fields: Record<AuthoringKind, AuthoringField> = {
  knowledge: 'knowledge', workflow: 'workflows', skill: 'skills', tool: 'tools',
}

function blankItem(): AuthoringItem {
  return { id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: '', description: '', enabled: true, body: '', steps: [], documents: [], updatedAt: 0 }
}

function createWorkflowDebugSubscription(ctx: Context): SubscribeWorkflowDebug {
  return (listener) => {
    const disposers = [
      ctx.remote.$on('workflow/start', (info) => { listener({ kind: 'start', runId: String(info.id), workflowName: info.meta.name, at: Date.now() }) }),
      ctx.remote.$on('workflow/phase', (info, title) => { listener({ kind: 'phase', runId: String(info.id), workflowName: info.meta.name, title, at: Date.now() }) }),
      ctx.remote.$on('workflow/log', (info, message) => { listener({ kind: 'log', runId: String(info.id), workflowName: info.meta.name, message, at: Date.now() }) }),
      ctx.remote.$on('workflow/agent-start', (info, agent) => { listener({ kind: 'agent-start', runId: String(info.id), workflowName: info.meta.name, seq: agent.seq, label: agent.label, ...(agent.phase === undefined ? {} : { phase: agent.phase }), at: Date.now() }) }),
      ctx.remote.$on('workflow/agent-end', (info, agent) => { listener({ kind: 'agent-end', runId: String(info.id), workflowName: info.meta.name, seq: agent.seq, label: agent.label, outcome: agent.outcome, at: Date.now() }) }),
      ctx.remote.$on('workflow/node-start', (info, node) => { listener({ kind: 'node-start', runId: String(info.id), workflowName: info.meta.name, nodeId: node.nodeId, label: node.label, retryCount: node.retryCount, at: Date.now() }) }),
      ctx.remote.$on('workflow/node-end', (info, node) => { listener({ kind: 'node-end', runId: String(info.id), workflowName: info.meta.name, nodeId: node.nodeId, label: node.label, status: node.status, durationMs: node.durationMs, ...(node.error === undefined ? {} : { error: node.error }), at: Date.now() }) }),
      ctx.remote.$on('workflow/end', (info, result) => { listener({ kind: 'end', runId: String(info.id), workflowName: info.meta.name, stopReason: result.stopReason, ...(result.error === undefined ? {} : { error: result.error }), agentsStarted: result.agentsStarted, at: Date.now() }) }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }
}

function createWorkflowCredentialControls(ctx: Context): WorkflowCredentialControls {
  return {
    describe: async (ref) => {
      const response = await ctx.remote.credentials.describe([ref])
      if (!response.ok) throw new Error(response.error.message)
      const info = response.value[ref]
      if (info === undefined) throw new Error('Credential state unavailable')
      return info
    },
    set: async (ref, value) => {
      const response = await ctx.remote.credentials.set(ref, value)
      if (!response.ok) throw new Error(response.error.message)
    },
    unset: async (ref) => {
      const response = await ctx.remote.credentials.unset(ref)
      if (!response.ok) throw new Error(response.error.message)
    },
    subscribe: listener => ctx.remote.$on('credentials/reference-updated', (ref) => { listener(String(ref)) }),
  }
}

function iconFor(kind: AuthoringKind, size = 16) {
  if (kind === 'knowledge') return <IconDatabaseOutline16 size={size} />
  if (kind === 'workflow') return <IconBranchOutline16 size={size} />
  if (kind === 'skill') return <IconSkillOutline16 size={size} />
  return <IconApiOutline14 size={size} />
}

function useScope(scope: SettingsScope<AuthoringSettings>): AuthoringSettings {
  const snapshot = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
    () => scope.getSnapshot(),
  )
  return snapshot.value ?? { skills: [], workflows: [], tools: [], knowledge: [] }
}

/**
 * Product navigation inside the sidebar, above the workspace section: one
 * full-width row per destination, mirroring the session rows below, or a
 * centered icon column in the collapsed rail. There is no Conversation entry —
 * the sidebar's own New Session control and the workspace browser are the way
 * back to the conversation. Panel entries contributed through
 * `sidebar.navigation.panels` (the workspace Flow page) take their own row
 * beside the built-in ones.
 */
function ProductNavigation({
  active, select, panels, renderSlot, compact, t,
}: {
  active: string | null
  select: (id: string | null) => void
  panels: readonly NavigationPanelMetadata[]
  renderSlot: PropsRenderSlots<'sidebar.navigation.panels'>['renderSlot']
  compact: boolean
  t: (key: keyof typeof zh) => string
}) {
  const items: { id: string; key: keyof typeof zh; kind: AuthoringKind }[] = [
    { id: PANEL_IDS.knowledge, key: 'nav.knowledge', kind: 'knowledge' },
    { id: PANEL_IDS.workflow, key: 'nav.workflow', kind: 'workflow' },
    { id: PANEL_IDS.skill, key: 'nav.skill', kind: 'skill' },
    { id: PANEL_IDS.tool, key: 'nav.tool', kind: 'tool' },
  ]
  const entry = (id: string, label: string, icon: ReactNode, activeState: boolean) => (
    <Tooltip key={id} label={label} delayMs={400} maxWidth={220} disabled={!compact}>
      <button
        type="button"
        className={css.navigationButton}
        data-active={activeState || undefined}
        aria-current={activeState ? 'page' : undefined}
        aria-label={label}
        onClick={() => { select(id) }}
      >
        <span className={css.navigationIcon} aria-hidden="true">{icon}</span>
        {!compact && <span className={css.navigationLabel}>{label}</span>}
      </button>
    </Tooltip>
  )
  return (
    <nav className={compact ? `${css.navigation} ${css.navigationCompact}` : css.navigation} aria-label={t('nav.label')}>
      {items.map(item => entry(item.id, t(item.key), iconFor(item.kind), active === item.id))}
      {panels.map(panel => entry(
        panel.id,
        panel.label,
        renderSlot('sidebar.navigation.panels', { size: 16, active: active === panel.id, compact }, { only: panel.id }),
        active === panel.id,
      ))}
      <div className={css.navigationDivider} />
      {entry('plugins', t('nav.plugins'), <IconCordisPluginOutline14 size={16} />, active === 'plugins')}
    </nav>
  )
}

function blankDocument(): KnowledgeDocument {
  return { id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: '', content: '', updatedAt: 0 }
}

function DocumentsEditor({ item, setItem, t }: {
  item: AuthoringItem
  setItem: (item: AuthoringItem) => void
  t: (key: keyof typeof zh) => string
}) {
  const documents = item.documents ?? []
  const [uploading, setUploading] = useState(false)
  const updateDocument = (id: string, patch: Partial<KnowledgeDocument>) => {
    setItem({ ...item, documents: documents.map(document => document.id === id ? { ...document, ...patch } : document) })
  }
  const addDocument = () => { setItem({ ...item, documents: [...documents, blankDocument()] }) }
  const uploadDocuments = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ''
    if (files.length === 0) return
    setUploading(true)
    try {
      const uploaded = await Promise.all(files.map(async file => ({
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: file.name,
        content: await file.text(),
        updatedAt: Date.now(),
      })))
      setItem({ ...item, documents: [...documents, ...uploaded] })
    } finally {
      setUploading(false)
    }
  }
  return (
    <div className={css.field}>
      <div className={css.stepHeader}>
        <span className={css.label}>{t('documents')}</span>
        <div className={css.documentActions}>
          <Button size="sm" icon={<IconPlusOutline16 />} onClick={addDocument}>{t('addDocument')}</Button>
          <label className={css.uploadButton}>
            <IconPlusOutline16 size={14} aria-hidden="true" />
            <span>{uploading ? t('uploading') : t('uploadDocument')}</span>
            <input
              type="file"
              multiple
              accept=".txt,.md,.markdown,.json,.csv,.yaml,.yml,text/plain,text/markdown,application/json,text/csv,text/yaml"
              aria-label={t('uploadDocument')}
              disabled={uploading}
              onChange={(event) => { void uploadDocuments(event) }}
            />
          </label>
        </div>
      </div>
      <div className={css.documents}>
        {documents.map((document, index) => (
          <div className={css.document} key={document.id}>
            <div className={css.documentHeader}>
              <span className={css.stepNumber}>{index + 1}</span>
              <input
                className={`${css.input} ${css.documentTitle}`}
                value={document.title}
                placeholder={t('documentName')}
                aria-label={`${t('documentName')} ${index + 1}`}
                onChange={(event) => { updateDocument(document.id, { title: event.target.value }) }}
              />
              <button type="button" className={css.iconButton} title={t('remove')} onClick={() => { setItem({ ...item, documents: documents.filter(candidate => candidate.id !== document.id) }) }}>
                <IconCloseOutline16 size={14} />
              </button>
            </div>
            <textarea
              className={`${css.textarea} ${css.documentContent}`}
              value={document.content}
              placeholder={t('documentContent')}
              aria-label={`${t('documentContent')} ${index + 1}`}
              onChange={(event) => { updateDocument(document.id, { content: event.target.value }) }}
            />
          </div>
        ))}
        {documents.length === 0 && <p className={css.hint}>{t('documentsEmpty')}</p>}
      </div>
    </div>
  )
}

function AuthoringPanel({ kind, scope, t }: {
  kind: AuthoringKind
  scope: SettingsScope<AuthoringSettings>
  t: (key: keyof typeof zh) => string
}) {
  const settings = useScope(scope)
  const items = settings[fields[kind]]
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null)
  const [draft, setDraft] = useState<AuthoringItem | null>(items[0] ?? null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const selected = selectedId === null ? items[0] : items.find(item => item.id === selectedId)
    if (selected !== undefined) { setSelectedId(selected.id); setDraft(selected) }
  }, [items, kind, selectedId])
  const selectItem = (item: AuthoringItem) => { setSelectedId(item.id); setDraft(item); setSaved(false) }
  const createItem = () => { const next = blankItem(); setSelectedId(next.id); setDraft(next); setSaved(false) }
  const save = async () => {
    if (draft === null || draft.title.trim() === '' || !scope.getSnapshot().writable) return
    setSaving(true)
    const next = [...items.filter(item => item.id !== draft.id), { ...draft, title: draft.title.trim(), updatedAt: Date.now() }]
    try { await scope.set(fields[kind], next); setSaved(true) } finally { setSaving(false) }
  }
  const title = kind === 'knowledge' ? t('knowledge.title') : kind === 'skill' ? t('skill.title') : kind === 'workflow' ? t('workflow.title') : t('tool.title')
  return (
    <div className={css.panel}>
      <aside className={css.list}>
        <div className={css.listHeader}><h2 className={css.listTitle}>{title}</h2><Button size="sm" icon={<IconPlusOutline16 />} aria-label={t('create')} onClick={createItem}>{t('create')}</Button></div>
        <div className={css.listItems}>
          {items.map(item => <button type="button" className={css.listItem} data-active={item.id === selectedId || undefined} key={item.id} onClick={() => { selectItem(item) }}><span className={css.itemTitle}>{item.title || t('name')}</span><span className={css.itemDescription}>{item.description || t('description')}</span></button>)}
          {items.length === 0 && <div className={css.empty}>{t('empty')}</div>}
        </div>
      </aside>
      <main className={css.editor}>
        <div className={css.editorInner}>
          <div className={css.editorHeader}><div><h1 className={css.editorTitle}>{title}</h1><p className={css.editorSubtitle}>{kind === 'knowledge' ? t('knowledge.subtitle') : t('instructions')}</p></div></div>
          {draft === null ? <div className={css.empty}>{t('empty')}</div> : <>
            <label className={css.field}><span className={css.label}>{t('name')}</span><input className={css.input} value={draft.title} placeholder={t('name')} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setSaved(false) }} /></label>
            <label className={css.field}><span className={css.label}>{t('description')}</span><input className={css.input} value={draft.description} placeholder={t('description')} onChange={(e) => { setDraft({ ...draft, description: e.target.value }); setSaved(false) }} /></label>
            <label className={css.toggle}><input type="checkbox" checked={draft.enabled} onChange={(e) => { setDraft({ ...draft, enabled: e.target.checked }); setSaved(false) }} /><span>{t('enabled')}</span></label>
            {kind !== 'knowledge' && <label className={css.field}><span className={css.label}>{t('instructions')}</span><textarea className={css.textarea} value={draft.body} onChange={(e) => { setDraft({ ...draft, body: e.target.value }); setSaved(false) }} /></label>}
            {kind === 'knowledge' && <DocumentsEditor item={draft} setItem={(item) => { setDraft(item); setSaved(false) }} t={t} />}
            {(kind === 'workflow' || kind === 'skill' || kind === 'tool') && <StepsEditor item={draft} setItem={(item) => { setDraft(item); setSaved(false) }} t={t} />}
            <div className={css.actions}><Button variant="primary" icon={<IconEditOutline16 />} disabled={saving || draft.title.trim() === ''} onClick={() => { void save() }}>{saving ? t('saved') : t('save')}</Button>{saved && <span className={css.status}>{t('saved')}</span>}{!scope.getSnapshot().writable && <span className={css.warning}>{t('storageUnavailable')}</span>}</div>
          </>}
        </div>
      </main>
    </div>
  )
}

export function registerAuthoringSurface(
  ctx: Context,
  instance: ReturnType<ReturnType<typeof createLayoutStore>['create']>,
): void {
  const scope = ctx.settingsScope.bind<AuthoringSettings>({ namespace: 'ui-authoring' })
  ctx.effect(() => ctx.locale.register('layout', { zh, en }), 'ui-layout: authoring dictionaries')
  const t = ctx.locale.bind('layout')
  const workflowCredentialControls = createWorkflowCredentialControls(ctx)
  const panelInfo = {
    getSnapshot: () => instance.getSnapshot().panelInfo,
    subscribe: (listener: () => void) => instance.subscribe(listener),
  }
  const select = (id: string | null) => { ctx.layout.selectPanel(id as MainPanelId | null) }
  ctx.inject(['remote', 'remote.knowledge'], (knowledgeContext: Context) => {
    const remote = knowledgeContext.remote.knowledge
    knowledgeContext.slots.inject('conversation.input.left', () => knowledgeContext.slots.register({
      name: 'conversation.input.left',
      id: 'knowledge-conversation-control',
      locale: 'layout',
      inject: (): KnowledgeConversationControlInjected => ({
        overview: () => remote.overview(),
        selected: id => remote.selected(id as SessionId),
        setSelected: (id, baseIds) => remote.setSelected(id as SessionId, baseIds),
        openManagement: () => { ctx.layout.selectPanel(PANEL_IDS.knowledge as MainPanelId) },
      }),
    }, KnowledgeConversationControl))
  })
  const saveTool = async (item: AuthoringItem): Promise<void> => {
    const snapshot = scope.getSnapshot()
    if (!snapshot.writable || snapshot.value === undefined) throw new Error('Tool storage unavailable')
    const items = snapshot.value.tools
    await scope.set('tools', items.some(candidate => candidate.id === item.id)
      ? items.map(candidate => candidate.id === item.id ? item : candidate)
      : [...items, item])
  }
  const saveSkill = async (item: AuthoringItem): Promise<void> => {
    const snapshot = scope.getSnapshot()
    if (!snapshot.writable || snapshot.value === undefined) throw new Error('Skill storage unavailable')
    const items = snapshot.value.skills
    await scope.set('skills', items.some(candidate => candidate.id === item.id)
      ? items.map(candidate => candidate.id === item.id ? item : candidate)
      : [...items, item])
  }
  const openConversationDraft = async (prefix: string): Promise<void> => {
    // Resolve the existing input service without a cyclic UI package import.
    const conversation = ctx.get('conversation') as {
      input: { for(scope: Context): { setDraft(text: string): void; state: { getSnapshot(): { draft: string } } } }
    } | undefined
    const sessions = ctx.get('sessions') as unknown as ISessions | undefined
    const workspaces = ctx.get('workspaces') as { list: { getSnapshot(): { items: readonly { workspaceId: string }[] } } } | undefined
    const uiWorkspace = ctx.get('uiWorkspace') as { connectWorkspace(id: string): Promise<string>; openSession(id: string): void } | undefined
    if (conversation === undefined || sessions === undefined || workspaces === undefined || uiWorkspace === undefined) throw new Error('Conversation unavailable')
    const navigation = ctx.layout.beginNavigation()
    const current = sessions.list.getSnapshot().current
    const firstWorkspace = workspaces.list.getSnapshot().items[0]
    const id = current ?? (firstWorkspace === undefined
      ? await sessions.create()
      : await uiWorkspace.connectWorkspace(firstWorkspace.workspaceId))
    if (navigation.aborted) return
    const sessionScope = sessions.scope(id as SessionId)
    if (sessionScope === undefined) throw new Error('Session unavailable')
    const input = conversation.input.for(sessionScope)
    const draft = input.state.getSnapshot().draft
    if (!draft.startsWith(prefix)) input.setDraft(`${prefix}${draft}`)
    uiWorkspace.openSession(id)
  }
  const invokeSkill = async (name: string): Promise<void> => { await openConversationDraft(`/${name} `) }
  const invokeWorkflow = async (id: string, title: string): Promise<void> => {
    const item = scope.getSnapshot().value?.workflows.find(candidate => candidate.id === id)
    if (item === undefined) throw new Error('Workflow unavailable')
    await openConversationDraft(`请调用工作流工具 ${runtimeToolName('workflow', item)} 执行“${title}”。\n\n`)
  }
  let workflowSession: ISession | undefined
  let workflowSessionId: SessionId | undefined
  const resolveWorkflowSession = async (): Promise<{ session: ISession; id: SessionId; openSession: (id: string) => void }> => {
    const sessions = ctx.get('sessions') as unknown as ISessions | undefined
    const workspaces = ctx.get('workspaces') as { list: { getSnapshot(): { items: readonly { workspaceId: string }[] } } } | undefined
    const uiWorkspace = ctx.get('uiWorkspace') as { connectWorkspace(id: string): Promise<string>; openSession(id: string): void } | undefined
    if (sessions === undefined || workspaces === undefined || uiWorkspace === undefined) throw new Error('Conversation unavailable')
    const navigation = ctx.layout.beginNavigation()
    const current = sessions.list.getSnapshot().current
    const firstWorkspace = workspaces.list.getSnapshot().items[0]
    const id = current ?? (firstWorkspace === undefined
      ? await sessions.create()
      : await uiWorkspace.connectWorkspace(firstWorkspace.workspaceId))
    if (navigation.aborted) throw new Error('Navigation aborted')
    const session = sessions.binding(id as SessionId)?.session
    if (session === undefined) throw new Error('Session unavailable')
    workflowSession = session
    workflowSessionId = id as SessionId
    return { session, id: id as SessionId, openSession: uiWorkspace.openSession }
  }
  const workflowSessionOrResolve = async (): Promise<ISession> => workflowSession ?? (await resolveWorkflowSession()).session
  const workflowArguments = (input: WorkflowRunInput): unknown => {
    if (input.mode !== 'json') return { input: input.text }
    let parsed: unknown
    try { parsed = JSON.parse(input.text.trim() === '' ? 'null' : input.text) }
    catch { throw new Error('Workflow input must be valid JSON') }
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && ('input' in parsed || 'variables' in parsed)
      ? parsed
      : { input: parsed }
  }
  const runWorkflow: WorkflowRunStartHandler = async (item: AuthoringItem, input: WorkflowRunInput = { text: '', mode: 'text' }): Promise<WorkflowRunStart> => {
    const resolved = await resolveWorkflowSession()
    const compiled = compileWorkflow(item)
    if (compiled === undefined) throw new Error('Workflow graph is invalid')
    const args = workflowArguments(input)
    const result = await resolved.session.workflowStart({
      workflowId: item.id,
      script: compiled.script,
      nodeIds: compiled.nodeIds,
      ...(item.workflowStatus === 'published' && item.version !== undefined && item.version !== null ? { workflowVersion: item.version } : {}),
      meta: compiled.meta,
      args: args as never,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    })
    if (!result.ok) throw new Error(result.error.message)
    resolved.openSession(resolved.id)
    return result.value
  }
  const cancelWorkflow = async (runId: string): Promise<void> => {
    const result = await workflowSessionOrResolve().then(session => session.workflowCancel(runId as never))
    if (!result.ok) throw new Error(result.error.message)
  }
  const statusWorkflow = async (runId: string): Promise<WorkflowRunView | undefined> => {
    const result = await workflowSessionOrResolve().then(session => session.workflowStatus(runId as never))
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const listWorkflowRuns = async (workflowId: string): Promise<readonly WorkflowRunView[]> => {
    let session = workflowSession
    if (session === undefined) {
      const sessions = ctx.get('sessions') as unknown as ISessions | undefined
      if (sessions === undefined) return []
      const current = sessions.list.getSnapshot().current
      session = current === null || current === undefined ? undefined : sessions.binding(current)?.session
      if (session !== undefined) workflowSession = session
    }
    if (session === undefined) return []
    const result = await session.workflowList({ workflowId, limit: 30 })
    if (!result.ok) throw new Error(result.error.message)
    return result.value.runs
  }
  const workflowRunControls: WorkflowRunControls = { cancel: cancelWorkflow, status: statusWorkflow, list: listWorkflowRuns }
  const scheduleView = (record: WorkflowScheduleRecord): WorkflowScheduleView => ({
    id: String(record.id),
    kind: record.kind === 'every' ? 'every' : 'at',
    scheduledAt: record.scheduledAt,
    ...(record.kind === 'every' ? { everySeconds: record.everySeconds } : {}),
    workflowVersion: record.target.workflowVersion,
  })
  const workflowScheduleControls: WorkflowScheduleControls = {
    create: async (item, input) => {
      const version = item.version
      if (item.workflowStatus !== 'published' || version === undefined || version === null || version < 1) throw new Error('Only published workflows can be scheduled')
      const resolved = await resolveWorkflowSession()
      const compiled = compileWorkflow(item)
      if (compiled === undefined) throw new Error('Workflow graph is invalid')
      const timing = input.kind === 'at'
        ? input.at === undefined ? (() => { throw new Error('An absolute schedule time is required') })() : { at: input.at }
        : input.everySeconds === undefined ? (() => { throw new Error('A recurring schedule interval is required') })() : { everySeconds: input.everySeconds }
      const response = await ctx.remote.workflowSchedules.create(resolved.id, {
        label: item.title,
        workflowId: item.id,
        workflowVersion: version,
        workflowName: compiled.meta.name,
        script: compiled.script,
        nodeIds: compiled.nodeIds,
        args: workflowArguments(input.input) as never,
        ...(input.input.timeoutMs === undefined ? {} : { timeoutMs: input.input.timeoutMs }),
        ...timing,
      })
      if (!response.ok) throw new Error(response.error.message)
      resolved.openSession(resolved.id)
      return scheduleView(response.value)
    },
    list: async (workflowId) => {
      if (workflowSessionId === undefined) {
        const sessions = ctx.get('sessions') as unknown as ISessions | undefined
        const current = sessions?.list.getSnapshot().current
        if (current === null || current === undefined) return []
        workflowSessionId = current
      }
      const response = await ctx.remote.workflowSchedules.list(workflowSessionId, workflowId)
      if (!response.ok) throw new Error(response.error.message)
      return response.value.map(scheduleView)
    },
    delete: async (id) => {
      if (workflowSessionId === undefined) await resolveWorkflowSession()
      const response = await ctx.remote.workflowSchedules.delete(workflowSessionId as SessionId, id)
      if (!response.ok) throw new Error(response.error.message)
      if (!response.value.deleted) throw new Error('Workflow schedule was not found')
    },
  }
  const saveWorkflow = async (item: AuthoringItem): Promise<void> => {
    const snapshot = scope.getSnapshot()
    if (!snapshot.writable || snapshot.value === undefined) throw new Error('Workflow storage unavailable')
    const items = snapshot.value.workflows
    await scope.set('workflows', items.some(candidate => candidate.id === item.id)
      ? items.map(candidate => candidate.id === item.id ? item : candidate)
      : [...items, item])
  }
  const removeWorkflow = async (id: string): Promise<void> => {
    const snapshot = scope.getSnapshot()
    if (!snapshot.writable || snapshot.value === undefined) throw new Error('Workflow storage unavailable')
    await scope.set('workflows', snapshot.value.workflows.filter(item => item.id !== id))
  }
  // The navigation row's panel entries are metadata from
  // `sidebar.navigation.panels`; ui-workspace registers the Flow page there, so
  // it appears beside the built-in entries.
  const navigationPanels = createSnapshotStore<readonly NavigationPanelMetadata[]>([])
  const syncNavigationPanels = (): void => {
    const next = ctx.slots.entriesOfSlot('sidebar.navigation.panels').map(({ options }) => {
      const id = options.id as MainPanelId
      return { id, order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? id }
    }).sort((a, b) => a.order - b.order)
    const previous = navigationPanels.getSnapshot()
    if (previous.length === next.length && previous.every((panel, index) => {
      const candidate = next[index] as NavigationPanelMetadata
      return panel.id === candidate.id && panel.order === candidate.order && panel.label === candidate.label
    })) return
    navigationPanels.set(next)
  }
  ctx.effect(() => ctx.slots.subscribe('sidebar.navigation.panels', syncNavigationPanels), 'ui-layout: navigation panel entries')
  ctx.effect(() => ctx.locale.subscribe(syncNavigationPanels), 'ui-layout: navigation panel labels')
  syncNavigationPanels()
  // The sidebar declares the seat; this occupant declares the panel list nested
  // inside it, which keeps `sidebar.navigation.panels` a child of the row that
  // renders it rather than a second seat on the sidebar entry.
  ctx.slots.inject('sidebar.navigation', () => ctx.slots.register({
    name: 'sidebar.navigation',
    locale: 'layout',
    children: { 'sidebar.navigation.panels': { kind: 'list', scope: 'root' } },
    inject: () => ({ hooks: { navigationPanels } }),
  }, (props) => {
    const active = useSyncExternalStore(
      listener => panelInfo.subscribe(listener),
      () => panelInfo.getSnapshot(),
      () => panelInfo.getSnapshot(),
    ).activePanelId
    return (
      <ProductNavigation
        active={active}
        select={select}
        panels={props.useNavigationPanels(value => value)}
        renderSlot={props.renderSlot}
        compact={props.compact}
        t={t}
      />
    )
  }))
  for (const kind of ['knowledge', 'workflow', 'skill', 'tool'] as const) {
    const key = PANEL_IDS[kind] as MainPanelId
    if (kind === 'knowledge') {
      ctx.inject(['remote', 'remote.knowledge'], (knowledgeContext: Context) => {
        const remote = knowledgeContext.remote.knowledge
        const callbacks: Omit<KnowledgePanelProps, 'legacy' | 'writable' | 't'> = {
          overview: () => remote.overview(), get: id => remote.get(id), save: draft => remote.save(draft),
          remove: (id, revision) => remote.deleteBase(id, revision), reindex: id => remote.reindex(id),
          preview: (documents, split) => remote.preview(documents, split),
          search: (query, id, signal) => remote.search(query, id, signal),
          importLegacy: items => remote.importLegacy(items),
        }
        // Drafting is optional: a deployment without the authoring assistant
        // renders the panel without its chat entry. Cordis refuses an
        // undeclared `remote.<ns>` read, so the namespace is captured by an
        // explicit injection instead of being reached through the root proxy.
        let assistant: AuthoringAssistantRemote | undefined
        knowledgeContext.inject(['remote', 'remote.authoringAssistant'], (assistantContext: Context) => {
          assistant = (assistantContext.remote as unknown as { authoringAssistant: AuthoringAssistantRemote }).authoringAssistant
        })
        const generate: NonNullable<KnowledgePanelProps['generate']> = async (request) => {
          if (assistant === undefined) throw new Error('Authoring assistant is unavailable')
          const result = await assistant.generateKnowledge(request, new AbortController().signal)
          if (!result.ok) throw new Error(result.error.message ?? 'Drafting failed')
          return result.value
        }
        knowledgeContext.slots.inject('main', () => knowledgeContext.slots.register({
          name: 'main', key, locale: 'layout',
          inject: () => ({ ...callbacks, generate, hooks: { authoring: scope } }),
        }, (props) => {
          const snapshot = props.useAuthoring(value => value)
          return <KnowledgePanel {...props} legacy={snapshot.value?.knowledge} writable={snapshot.writable} t={t} />
        }))
      })
      continue
    }
    if (kind === 'tool') {
      ctx.inject(['remote', 'remote.pluginInventory'], (toolContext: Context) => {
        const loadUsage: ToolsPanelProps['loadUsage'] = async (signal) => {
          const result = await toolContext.remote.pluginInventory.toolUsage(signal)
          if (!result.ok) throw new Error(`pluginInventory.toolUsage failed: ${result.error.code}`)
          return result.value
        }
        toolContext.slots.inject('main', () => toolContext.slots.register({
          name: 'main', key, locale: 'layout',
          inject: () => ({ hooks: { authoring: scope }, loadUsage, saveTool }),
        }, (props) => {
          const snapshot = props.useAuthoring(value => value)
          return <ToolsPanel items={snapshot.value?.tools ?? []} writable={snapshot.writable}
            loadUsage={props.loadUsage} save={props.saveTool} t={t} />
        }))
      })
      continue
    }
    if (kind === 'workflow') {
      // Same optional drafting path as the knowledge panel: an unmounted
      // assistant Remote leaves the panel without a chat entry rather than
      // rendering a button that always fails.
      let assistant: AuthoringAssistantRemote | undefined
      ctx.inject(['remote', 'remote.authoringAssistant'], (assistantContext: Context) => {
        assistant = (assistantContext.remote as unknown as { authoringAssistant: AuthoringAssistantRemote }).authoringAssistant
      })
      const generateWorkflow = async (request: WorkflowGenerateRequest): Promise<WorkflowGenerateValue> => {
        if (assistant === undefined) throw new Error('Authoring assistant is unavailable')
        const result = await assistant.generateWorkflow(request, new AbortController().signal)
        if (!result.ok) throw new Error(result.error.message ?? 'Drafting failed')
        return result.value
      }
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main', key, locale: 'layout',
        inject: () => ({ hooks: { authoring: scope }, saveWorkflow, removeWorkflow, invokeWorkflow, runWorkflow, workflowRunControls, workflowScheduleControls, workflowCredentialControls,
          subscribeWorkflowDebug: createWorkflowDebugSubscription(ctx), generate: generateWorkflow }),
      }, (props) => {
        const snapshot = props.useAuthoring(value => value)
        return <WorkflowPanel items={snapshot.value?.workflows ?? []} writable={snapshot.writable}
          save={props.saveWorkflow} remove={props.removeWorkflow} invoke={props.invokeWorkflow}
          {...props.subscribeWorkflowDebug === undefined ? {} : { subscribeDebug: props.subscribeWorkflowDebug }} run={props.runWorkflow} runControls={props.workflowRunControls} schedules={props.workflowScheduleControls} credentials={props.workflowCredentialControls}
          {...props.generate === undefined ? {} : { generate: props.generate }} t={t} />
      }))
      continue
    }
    if (kind === 'skill') {
      ctx.inject(['remote', 'remote.localSkillImport'], (skillContext: Context) => {
        const scanLocalSkills = async () => {
          const result = await skillContext.remote.localSkillImport.list()
          if (!result.ok) throw new Error(`localSkillImport.list failed: ${result.error.code}`)
          return result.value
        }
        const loadLocalSkill = async (id: string) => {
          const result = await skillContext.remote.localSkillImport.archive(id)
          if (!result.ok) throw new Error(`localSkillImport.archive failed: ${result.error.code}`)
          return result.value
        }
        skillContext.slots.inject('main', () => skillContext.slots.register({
          name: 'main', key, locale: 'layout',
          inject: () => ({ hooks: { authoring: scope }, saveSkill, invokeSkill, scanLocalSkills, loadLocalSkill }),
        }, (props) => {
          const snapshot = props.useAuthoring(value => value)
          return <SkillsPanel items={snapshot.value?.skills ?? []} writable={snapshot.writable} loading={snapshot.status === 'loading'} save={props.saveSkill} invoke={props.invokeSkill} scanLocalSkills={props.scanLocalSkills} loadLocalSkill={props.loadLocalSkill} t={t} />
        }))
      })
      continue
    }
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key, locale: 'layout' }, () => <AuthoringPanel kind={kind} scope={scope} t={t} />))
  }
}
