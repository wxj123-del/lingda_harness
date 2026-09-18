import { useEffect, useState, useSyncExternalStore, type ChangeEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MainPanelId } from '../service.ts'
import type { createLayoutStore } from '../stores.ts'
import type { AuthoringItem, AuthoringSettings, KnowledgeDocument } from '../../authoring-settings.ts'
import { IconApiOutline14, IconCodeOutline16, IconCordisPluginOutline14, IconDatabaseOutline16, IconEditOutline16, IconNewChatOutline16, IconSkillOutline16, IconPlusOutline16, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { en, zh } from '../locales.ts'
import css from './AuthoringPanel.module.css'
import { StepsEditor } from './StepsEditor.tsx'
import { SkillsPanel } from './SkillsPanel.tsx'
import { ToolsPanel, type ToolsPanelProps } from './ToolsPanel.tsx'
import { KnowledgePanel, type KnowledgePanelProps } from './KnowledgePanel.tsx'
import {
  KnowledgeConversationControl,
  type KnowledgeConversationControlInjected,
} from './KnowledgeConversationControl.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Composer tool-row seat used by the knowledge-base toggle. */
    'conversation.input.left': { kind: 'list'; scope: 'session' }
  }
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

function iconFor(kind: AuthoringKind, size = 16) {
  if (kind === 'knowledge') return <IconDatabaseOutline16 size={size} />
  if (kind === 'workflow') return <IconCodeOutline16 size={size} />
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

function NavigationRail({
  active, select, t,
}: { active: string | null; select: (id: string | null) => void; t: (key: keyof typeof zh) => string }) {
  const items: { id: string | null; key: keyof typeof zh; kind?: AuthoringKind }[] = [
    { id: null, key: 'nav.conversation' },
    { id: PANEL_IDS.knowledge, key: 'nav.knowledge', kind: 'knowledge' },
    { id: PANEL_IDS.workflow, key: 'nav.workflow', kind: 'workflow' },
    { id: PANEL_IDS.skill, key: 'nav.skill', kind: 'skill' },
    { id: PANEL_IDS.tool, key: 'nav.tool', kind: 'tool' },
  ]
  return (
    <nav className={css.navigation} aria-label={t('nav.label')}>
      {items.map(item => (
        <button
          key={item.id ?? 'conversation'}
          type="button"
          className={css.navigationButton}
          data-active={active === item.id || undefined}
          aria-current={active === item.id ? 'page' : undefined}
          aria-label={t(item.key)}
          onClick={() => { select(item.id) }}
        >
          <span className={css.navigationIcon}>{item.kind === undefined ? <IconNewChatOutline16 /> : iconFor(item.kind)}</span>
          <span>{t(item.key)}</span>
        </button>
      ))}
      <div className={css.navigationDivider} />
      <button type="button" className={css.navigationButton} aria-label={t('nav.plugins')}
        aria-current={active === 'plugins' ? 'page' : undefined}
        data-active={active === 'plugins' || undefined} onClick={() => { select('plugins') }}>
        <span className={css.navigationIcon}><IconCordisPluginOutline14 size={16} /></span>
        <span>{t('nav.plugins')}</span>
      </button>
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
        get: id => remote.get(id),
        save: draft => remote.save(draft),
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
  const invokeSkill = async (name: string): Promise<void> => {
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
    const token = `/${name} `
    const draft = input.state.getSnapshot().draft
    if (!draft.startsWith(token)) input.setDraft(`${token}${draft}`)
    uiWorkspace.openSession(id)
  }
  ctx.slots.inject('sidebar.navigation', () => ctx.slots.register({ name: 'sidebar.navigation', locale: 'layout' }, () => {
    const active = useSyncExternalStore(
      listener => panelInfo.subscribe(listener),
      () => panelInfo.getSnapshot(),
      () => panelInfo.getSnapshot(),
    ).activePanelId
    return <NavigationRail active={active} select={select} t={t} />
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
        knowledgeContext.slots.inject('main', () => knowledgeContext.slots.register({
          name: 'main', key, locale: 'layout',
          inject: () => ({ ...callbacks, hooks: { authoring: scope } }),
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
