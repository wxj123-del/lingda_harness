import { useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { AuthoringItem, AuthoringSettings } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
  Menu,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type AgentPresetGroup = NonNullable<PluginInventorySnapshot['agentPresets']>[number]
type AgentPresetRow = AgentPresetGroup['rows'][number]

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
  /**
   * Display name for one preset: shipped presets resolve through the
   * agent-preset dictionaries, user-authored ones keep their own metadata.
   */
  presetName: (preset: AgentPresetGroup) => string
  /** Read the durable user-authored Skill/workflow/tool/knowledge settings. */
  authoring: SettingsScope<AuthoringSettings>
}
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

type PluginCategory =
  | 'all'
  | 'skills'
  | 'rag'
  | 'tools'
  | 'agents'
  | 'models'
  | 'system'
  | 'integrations'
  | 'other'

const CATEGORY_ORDER = [
  'all',
  'skills',
  'rag',
  'tools',
  'agents',
  'models',
  'system',
  'integrations',
  'other',
] as const satisfies readonly PluginCategory[]

const CATEGORY_LABEL_KEYS = {
  all: 'categoryAll',
  skills: 'categorySkills',
  rag: 'categoryRag',
  tools: 'categoryTools',
  agents: 'categoryAgents',
  models: 'categoryModels',
  system: 'categorySystem',
  integrations: 'categoryIntegrations',
  other: 'categoryOther',
} as const satisfies Record<PluginCategory, PluginInventoryLocaleKey>

type AuthoringKind = 'skill' | 'workflow' | 'tool' | 'knowledge'
type UserPluginRow = {
  readonly kind: AuthoringKind
  readonly item: AuthoringItem
  readonly category: Exclude<PluginCategory, 'all'>
}

const EMPTY_AUTHORING: AuthoringSettings = { skills: [], workflows: [], tools: [], knowledge: [] }
const USER_TYPE_KEYS = {
  skill: 'userTypeSkill',
  workflow: 'userTypeWorkflow',
  tool: 'userTypeTool',
  knowledge: 'userTypeKnowledge',
} as const satisfies Record<AuthoringKind, PluginInventoryLocaleKey>
const UNAVAILABLE_AUTHORING_SNAPSHOT: SettingsScopeSnapshot<AuthoringSettings> = {
  status: 'unavailable', value: undefined, base: undefined, user: undefined,
  revision: undefined, writable: false, mode: 'memory',
}

function userPluginRows(settings: AuthoringSettings): UserPluginRow[] {
  return [
    ...settings.skills.map(item => ({ kind: 'skill' as const, item, category: 'skills' as const })),
    ...settings.workflows.map(item => ({ kind: 'workflow' as const, item, category: 'skills' as const })),
    ...settings.tools.map(item => ({ kind: 'tool' as const, item, category: 'tools' as const })),
    ...settings.knowledge.map(item => ({ kind: 'knowledge' as const, item, category: 'rag' as const })),
  ]
}

function userPluginRuntimeName(kind: AuthoringKind, item: AuthoringItem): string {
  const stableId = item.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const cleanId = stableId.replace(/^-+|-+$/g, '') || 'item'
  return kind === 'skill' ? `user-${cleanId}` : `user_${kind}_${cleanId}`
}

function userPluginSearchText(row: UserPluginRow): string {
  return [
    row.item.id,
    row.item.title,
    row.item.description,
    row.item.body,
    ...row.item.steps,
    ...(row.item.documents ?? []).flatMap(document => [document.title, document.content]),
  ].join(' ').toLocaleLowerCase()
}

/** Assign a stable browsing category from the metadata every inventory row shares. */
function pluginCategory(moduleName: string, entryId: string | null): Exclude<PluginCategory, 'all'> {
  const value = `${moduleName} ${entryId ?? ''}`.toLocaleLowerCase()
  if (/feishu|lark|mcp|slack|github|notion|linear|jira|discord|telegram|integration/.test(value)) {
    return 'integrations'
  }
  if (/rag|retriev|embedding|vector|knowledge|memory|semantic|knowledge-base/.test(value)) {
    return 'rag'
  }
  if (/skill|workflow|plan|goal|todo|command|prompt|instruction|ralph/.test(value)) {
    return 'skills'
  }
  if (/subagent|agent|delegat|spawn|fork/.test(value)) {
    return 'agents'
  }
  const modelTerms = [
    'imagegen', 'image-gen', 'image-generation', 'text-to-image', 'text2image', 'txt2img',
    'generate-image', 'image-generator', 'stable-diffusion', 'diffusion', 'diffusers',
    'comfyui', 'dall-e', 'midjourney', 'flux',
    'tts', 'stt', 'asr', 'voice', 'speech', 'audio', 'transcrib', 'text-to-speech',
    'speech-to-text', 'speech-synthesis', 'voice-generation', 'audio-generation',
    'whisper', 'elevenlabs', 'llm', 'model', 'provider', 'vision', 'multimodal',
    'token', 'compaction',
  ]
  if (modelTerms.some(term => value.includes(term))) {
    return 'models'
  }
  if (/tool|bash|pwsh|shell|terminal|subprocess|fs|file|workspace|browser|web|fetch|search|http|sandbox|ssh|lsp/.test(value)) {
    return 'tools'
  }
  const systemTerms = [
    'session', 'conversation', 'history', 'title', 'schedule', 'hook', 'settings',
    'credential', 'loader', 'host', 'client', 'ui', 'locale', 'theme', 'telemetry',
    'timer', 'identity', 'feedback', 'typert', 'gateway', 'runtime', 'system',
  ]
  if (systemTerms.some(term => value.includes(term))) {
    return 'system'
  }
  return 'other'
}

/** Full component props used by the independent main-panel renderer. */
export type PluginInventorySettingsTabProps =
  PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type Translate = PluginInventorySettingsTabProps['t']

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(phase: PluginFiberPhase, t: Translate): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Display an entry identity without the composition-only `include:` marker. */
function entrySubtitle(entryId: string): string {
  return entryId.replace(/^include:/, '')
}

/** Whether one row's module name or entry id matches the catalog query. */
function matches(moduleName: string, entryId: string | null, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [moduleName, ...entryId === null ? [] : [entryId]]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** The roster row shown when the preset switcher has no explicit choice. */
function fallbackPreset(presets: readonly AgentPresetGroup[]): AgentPresetGroup | undefined {
  return presets.find(preset => preset.isDefault) ?? presets[0]
}

/** The switcher's display label for one preset. */
function presetLabel(preset: AgentPresetGroup, t: Translate, presetName: (preset: AgentPresetGroup) => string): string {
  const name = presetName(preset)
  if (preset.broken !== undefined) return t('presetOptionBroken', { name })
  if (preset.isDefault) return t('presetOptionDefault', { name })
  return name
}

/** One expandable plugin card; the caller owns the trailing status content. */
function PluginCard({ rowKey, moduleName, entryId, trailing, ariaLabel, failed, expanded, onToggle, children }: {
  readonly rowKey: string
  readonly moduleName: string
  readonly entryId: string | null
  readonly trailing: ReactNode
  readonly ariaLabel: string
  readonly failed: boolean
  readonly expanded: string | null
  readonly onToggle: (key: string) => void
  readonly children: ReactNode
}): ReactNode {
  const open = expanded === rowKey
  const detailId = `plugin-details-${encodeURIComponent(rowKey)}`
  return (
    <li
      className={css.card}
      data-plugin-entry={entryId ?? undefined}
      data-plugin-module={moduleName}
      data-failed={failed ? 'true' : undefined}
      data-open={open ? 'true' : undefined}
    >
      <button
        className={css.cardContent}
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={ariaLabel}
        onClick={() => { onToggle(rowKey) }}
      >
        <span className={css.cardMainRow}>
          <strong className={css.cardTitle} title={moduleName}>{moduleShortName(moduleName)}</strong>
          <span className={css.cardTrailing}>
            {trailing}
            <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
          </span>
        </span>
        {entryId === null ? null : <code className={css.cardIdentity} title={entryId}>{entrySubtitle(entryId)}</code>}
      </button>
      {open ? <div className={css.cardDetails} id={detailId}>{children}</div> : null}
    </li>
  )
}

/** Detail rows shared by every card: the Loader identity, then labeled facts. */
function CardFacts({ moduleName, moduleLabel, entryId, facts }: {
  readonly moduleName: string
  readonly moduleLabel: string
  readonly entryId: string | null
  readonly facts: readonly (readonly [label: string, value: ReactNode])[]
}): ReactNode {
  return (
    <>
      {entryId === null ? null : <code className={css.entryValue} data-loader-entry>{entryId}</code>}
      <dl className={css.details}>
        <div>
          <dt>{moduleLabel}</dt>
          <dd>{moduleName}</dd>
        </div>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

/* `pending` is the only phase with no work under way. `loading` and
 * `unloading` are both live transitions the Host is running — an async
 * disposer can hold `unloading` for a while — so both animate. */
const PHASE_DOT_STATES = {
  pending: 'idle',
  loading: 'ongoing',
  active: 'done',
  failed: 'error',
  unloading: 'ongoing',
} as const satisfies Record<NonNullable<PluginFiberPhase>, StateDotState>

/** Status dot naming a live root-fiber phase; rows with no live fiber show none. */
function PhaseDot({ phase, t }: { readonly phase: NonNullable<PluginFiberPhase>; readonly t: Translate }): ReactNode {
  const status = phaseLabel(phase, t)
  /* StateDot is aria-hidden, so the phase name lives on this wrapper. */
  return (
    <span className={css.phaseDot} role="img" aria-label={status} title={status}>
      <StateDot state={PHASE_DOT_STATES[phase]} />
    </span>
  )
}

/** Enablement states one inventory row can report. */
type EnablementKind = 'enabled' | 'disabled' | 'conditional' | 'preset' | 'failed'

const TAG_TONES = {
  enabled: 'success',
  disabled: 'neutral',
  conditional: 'warning',
  preset: 'info',
  failed: 'danger',
} as const satisfies Record<EnablementKind, TagTone>

/** Enablement tag; `kind` selects the palette. */
function StateTag({ kind, label }: { readonly kind: EnablementKind; readonly label: string }): ReactNode {
  return <Tag tone={TAG_TONES[kind]}>{label}</Tag>
}

/** Render the read-only plugin inventory: agent presets first, then the global plane. */
export function PluginInventorySettingsTab({ list, presetName, authoring, t }: PluginInventorySettingsTabProps): ReactNode {
  const sectionId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [chosenPreset, setChosenPreset] = useState<string | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState<boolean | null>(null)
  const [globalOpen, setGlobalOpen] = useState<boolean | null>(null)
  const [category, setCategory] = useState<PluginCategory>('all')
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const authoringSnapshot = useSyncExternalStore(
    listener => authoring?.subscribe(listener) ?? (() => {}),
    () => authoring?.getSnapshot() ?? UNAVAILABLE_AUTHORING_SNAPSHOT,
    () => authoring?.getSnapshot() ?? UNAVAILABLE_AUTHORING_SNAPSHOT,
  )
  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const searching = normalizedQuery.length > 0
  const snapshot = state.status === 'ready' ? state.snapshot : undefined
  const presets = snapshot?.agentPresets ?? []
  const selected = presets.find(preset => preset.id === chosenPreset) ?? fallbackPreset(presets)

  /** Presets that actually enable a module, keyed by module name. */
  const enabledIn = useMemo(() => {
    const found = new Map<string, [AgentPresetGroup, ...AgentPresetGroup[]]>()
    for (const preset of presets) {
      for (const row of preset.rows) {
        if (row.enabled !== true) continue
        const groups = found.get(row.moduleName)
        if (groups === undefined) found.set(row.moduleName, [preset])
        else if (!groups.includes(preset)) groups.push(preset)
      }
    }
    return found
  }, [presets])

  const entries = snapshot?.entries ?? []
  const userRows = useMemo(() => userPluginRows(authoringSnapshot.value ?? EMPTY_AUTHORING), [authoringSnapshot.value])
  const failedEntries: PluginInventoryEntry[] = []
  const regularEntries: PluginInventoryEntry[] = []
  for (const entry of entries) {
    if (entry.fiberPhase === 'failed') failedEntries.push(entry)
    else regularEntries.push(entry)
  }

  const entryMatch = (entry: PluginInventoryEntry): boolean => matches(entry.moduleName, entry.entryId, normalizedQuery)
  const rowMatch = (row: AgentPresetRow): boolean => matches(row.moduleName, row.entryId, normalizedQuery)
  const categoryMatch = (moduleName: string, entryId: string | null): boolean =>
    category === 'all' || pluginCategory(moduleName, entryId) === category
  const matchingEntries = entries.filter(entryMatch)
  const matchingSelectedRows = selected === undefined ? [] : selected.rows.filter(rowMatch)
  const matchingUserRows = userRows.filter(row => userPluginSearchText(row).includes(normalizedQuery)
    && (category === 'all' || row.category === category))
  const categoryCounts = new Map<PluginCategory, number>(CATEGORY_ORDER.map(key => [key, 0]))
  categoryCounts.set('all', matchingEntries.length + matchingSelectedRows.length + userRows.filter(row => userPluginSearchText(row).includes(normalizedQuery)).length)
  for (const entry of matchingEntries) {
    const key = pluginCategory(entry.moduleName, entry.entryId)
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1)
  }
  for (const row of matchingSelectedRows) {
    const key = pluginCategory(row.moduleName, row.entryId)
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1)
  }
  for (const row of userRows) {
    if (!userPluginSearchText(row).includes(normalizedQuery)) continue
    categoryCounts.set(row.category, (categoryCounts.get(row.category) ?? 0) + 1)
  }
  const visibleCategories = CATEGORY_ORDER.filter(key => key === 'all' || key === category || (categoryCounts.get(key) ?? 0) > 0)
  const filteredFailed = failedEntries.filter(entry => entryMatch(entry) && categoryMatch(entry.moduleName, entry.entryId))
  const filteredRegular = regularEntries.filter(entry => entryMatch(entry) && categoryMatch(entry.moduleName, entry.entryId))
  const globalCount = filteredFailed.length + filteredRegular.length
  const selectedRows = selected === undefined
    ? []
    : selected.rows.filter(row => rowMatch(row) && categoryMatch(row.moduleName, row.entryId))
  const otherPresetMatches = searching
    ? presets.filter(preset => preset !== selected && preset.rows.some(row => rowMatch(row) && categoryMatch(row.moduleName, row.entryId)))
    : []
  const otherMatchCount = otherPresetMatches
    .reduce((total, preset) => total + preset.rows.filter(row => rowMatch(row) && categoryMatch(row.moduleName, row.entryId)).length, 0)

  const presetEffectiveOpen = searching || (presetOpen ?? true)
  const globalEffectiveOpen = searching || category !== 'all' || (globalOpen ?? presets.length === 0)
  const nothingMatches = searching && globalCount === 0 && selectedRows.length === 0
    && otherPresetMatches.length === 0 && matchingUserRows.length === 0
  const nothingInCategory = !searching && category !== 'all' && globalCount === 0 && selectedRows.length === 0 && matchingUserRows.length === 0

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }
  const toggleRow = (key: string): void => {
    setExpanded(current => current === key ? null : key)
  }

  const userRowCard = (row: UserPluginRow): ReactNode => {
    const title = row.item.title.trim() || t('untitledPlugin')
    const runtimeName = userPluginRuntimeName(row.kind, row.item)
    const stateText = row.item.enabled ? t('enabledTag') : t('disabledTag')
    const facts: readonly (readonly [label: string, value: ReactNode])[] = [
      [t('pluginType'), t(USER_TYPE_KEYS[row.kind])],
      [t('descriptionLabel'), row.item.description || t('noDescription')],
      [t('configuration'), stateText],
      [t('runtimeName'), <code key="runtime-name">{runtimeName}</code>],
      ...(row.kind === 'knowledge'
        ? [[t('documentCount'), String(row.item.documents?.length ?? 0)] as const]
        : [[t('stepCount'), String(row.item.steps.length)] as const]),
    ]
    return (
      <PluginCard
        key={`user:${row.kind}:${row.item.id}`}
        rowKey={`user:${row.kind}:${row.item.id}`}
        moduleName={title}
        entryId={runtimeName}
        failed={false}
        expanded={expanded}
        onToggle={toggleRow}
        ariaLabel={`${title}, ${stateText}`}
        trailing={<StateTag kind={row.item.enabled ? 'enabled' : 'disabled'} label={stateText} />}
      >
        <CardFacts moduleName={title} moduleLabel={t('pluginName')} entryId={runtimeName} facts={facts} />
      </PluginCard>
    )
  }

  /** Trailing status and detail facts for one row of the selected preset. */
  const presetRowCard = (preset: AgentPresetGroup, row: AgentPresetRow, index: number): ReactNode => {
    const key = `preset:${preset.id}:${String(index)}`
    const title = moduleShortName(row.moduleName)
    const failed = row.fiberPhase === 'failed'
    const stateText = failed
      ? t('failedTag')
      : row.enabled === true ? t('enabledTag') : row.enabled === false ? t('disabledTag') : t('conditionalTag')
    const kind = failed ? 'failed' : row.enabled === true ? 'enabled' : row.enabled === false ? 'disabled' : 'conditional'
    return (
      <PluginCard
        key={key}
        rowKey={key}
        moduleName={row.moduleName}
        entryId={row.entryId}
        failed={failed}
        expanded={expanded}
        onToggle={toggleRow}
        ariaLabel={`${title}${row.entryId === null ? '' : `, ${row.entryId}`}, ${stateText}`}
        trailing={(
          <>
            {row.enabled === true && !failed && row.fiberPhase !== null
              ? <PhaseDot phase={row.fiberPhase} t={t} />
              : null}
            <StateTag kind={kind} label={stateText} />
          </>
        )}
      >
        <CardFacts
          moduleName={row.moduleName}
          moduleLabel={t('moduleLabel')}
          entryId={row.entryId}
          facts={[
            [t('fromPreset'), presetName(preset)],
            [t('configuration'), stateText],
            ...row.fiberPhase === null ? [] : [[t('runtime'), phaseLabel(row.fiberPhase, t)] as const],
            ...row.condition === undefined ? [] : [[t('condition'), <code key="condition">{row.condition}</code>] as const],
          ]}
        />
      </PluginCard>
    )
  }

  /** One global-plane row; a preset-provided row carries the presets that enable it. */
  const globalRowCard = (
    entry: PluginInventoryEntry,
    providers?: readonly [AgentPresetGroup, ...AgentPresetGroup[]],
  ): ReactNode => {
    const key = `global:${entry.entryId}`
    const title = moduleShortName(entry.moduleName)
    const failed = entry.fiberPhase === 'failed'
    const stateText = failed
      ? t('failedTag')
      : providers !== undefined ? t('presetEnabledTag') : t(entry.enabled ? 'enabledTag' : 'disabledTag')
    const kind = failed ? 'failed' : providers !== undefined ? 'preset' : entry.enabled ? 'enabled' : 'disabled'
    return (
      <PluginCard
        key={key}
        rowKey={key}
        moduleName={entry.moduleName}
        entryId={entry.entryId}
        failed={failed}
        expanded={expanded}
        onToggle={toggleRow}
        ariaLabel={`${title}, ${entry.entryId}, ${stateText}`}
        trailing={(
          <>
            {entry.enabled && !failed && entry.fiberPhase !== null
              ? <PhaseDot phase={entry.fiberPhase} t={t} />
              : null}
            <StateTag kind={kind} label={stateText} />
          </>
        )}
      >
        <CardFacts
          moduleName={entry.moduleName}
          moduleLabel={t('moduleLabel')}
          entryId={entry.entryId}
          facts={providers !== undefined
            ? [
              [t('configuration'), t('presetProvidedDetail')],
              [t('enabledIn'), (
                <span className={css.enabledIn}>
                  <span>{providers.map(preset => presetName(preset)).join(' · ')}</span>
                  <button
                    type="button"
                    className={css.jumpLink}
                    onClick={() => { setChosenPreset(providers[0].id) }}
                  >
                    {t('viewInPreset')}
                  </button>
                </span>
              )],
            ]
            : [
              [t('configuration'), t(entry.enabled ? 'enabledTag' : 'disabledTag')],
              ...entry.enabled ? [[t('runtime'), phaseLabel(entry.fiberPhase, t)] as const] : [],
            ]}
        />
      </PluginCard>
    )
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {snapshot !== undefined ? (
        <div className={css.catalog}>
          <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          <div className={css.categoryBar} role="tablist" aria-label={t('categoryLabel')}>
            {visibleCategories.map(key => (
              <button
                key={key}
                type="button"
                role="tab"
                className={css.categoryTab}
                data-plugin-category={key}
                aria-selected={category === key}
                onClick={() => { setCategory(key) }}
              >
                <span>{t(CATEGORY_LABEL_KEYS[key])}</span>
                <span className={css.categoryCount}>{categoryCounts.get(key) ?? 0}</span>
              </button>
            ))}
          </div>
          {entries.length === 0 && presets.length === 0 && userRows.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {nothingMatches ? <p className={css.status}>{t('emptySearch')}</p> : null}
          {nothingInCategory ? <p className={css.status}>{t('emptyCategory')}</p> : null}

          {matchingUserRows.length > 0 ? (
            <section className={css.group} data-plugin-scope="user">
              <div className={css.groupTitleRow}>
                <span className={css.groupTitle}>{t('userTitle')}</span>
              </div>
              <p className={css.groupSub}>{t('userSubtitle')}<span data-user-plugin-count>{` · ${String(matchingUserRows.length)} ${t('countUnit')}`}</span></p>
              <ul className={css.cards}>{matchingUserRows.map(userRowCard)}</ul>
            </section>
          ) : null}

          {selected !== undefined ? (
            <section className={css.group} data-plugin-scope="preset" data-preset-id={selected.id}>
              <div className={css.groupTitleRow}>
                <button
                  type="button"
                  className={css.groupToggle}
                  aria-expanded={presetEffectiveOpen}
                  aria-controls={`${sectionId}-preset`}
                  onClick={() => { setPresetOpen(!presetEffectiveOpen) }}
                >
                  <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                  <span className={css.groupTitle}>{t('presetTitle')}</span>
                </button>
                <div className={css.headerEnd}>
                  <Menu
                    open={switcherOpen}
                    onClose={() => { setSwitcherOpen(false) }}
                    items={presets.map(preset => ({ id: preset.id, label: presetLabel(preset, t, presetName) }))}
                    selectedId={selected.id}
                    onSelect={(id) => {
                      setSwitcherOpen(false)
                      setChosenPreset(id)
                    }}
                    align="end"
                    portal
                    anchor={(
                      <button
                        type="button"
                        className={css.switcher}
                        aria-haspopup="menu"
                        aria-expanded={switcherOpen}
                        aria-label={t('switcherLabel')}
                        onClick={() => { setSwitcherOpen(value => !value) }}
                      >
                        <span className={css.switcherLabel}>{presetLabel(selected, t, presetName)}</span>
                        <IconChevronDownOutline14 className={css.chevron} aria-hidden="true" />
                      </button>
                    )}
                  />
                </div>
              </div>
              <p className={css.groupSub}>
                {t('presetSubtitle')}
                <span data-preset-plugin-count={selectedRows.length}>
                  {` · ${String(selectedRows.length)} ${t('countUnit')}`}
                </span>
              </p>
              {presetEffectiveOpen ? (
                <div id={`${sectionId}-preset`} className={css.groupBody}>
                  {selected.broken !== undefined ? (
                    <p className={css.brokenNote} role="alert">{selected.broken}</p>
                  ) : null}
                  {selectedRows.length > 0 ? (
                    <ul className={css.cards}>
                      {selectedRows.map((row, index) => presetRowCard(selected, row, index))}
                    </ul>
                  ) : null}
                  {otherMatchCount > 0 ? (
                    <p className={css.hint}>
                      {t('matchesInOtherPresets', { count: String(otherMatchCount) })}
                      {otherPresetMatches.map(preset => (
                        <button
                          key={preset.id}
                          type="button"
                          className={css.jumpLink}
                          onClick={() => { setChosenPreset(preset.id) }}
                        >
                          {presetName(preset)}
                        </button>
                      ))}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {entries.length > 0 ? (
            <section className={css.group} data-plugin-scope="global">
              <div className={css.groupTitleRow}>
                <button
                  type="button"
                  className={css.groupToggle}
                  aria-expanded={globalEffectiveOpen}
                  aria-controls={`${sectionId}-global`}
                  onClick={() => { setGlobalOpen(!globalEffectiveOpen) }}
                >
                  <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                  <span className={css.groupTitle}>{t('globalTitle')}</span>
                </button>
              </div>
              <p className={css.groupSub}>
                {t('globalSubtitle')}
                <span data-plugin-count={globalCount}>{` · ${String(globalCount)} ${t('countUnit')}`}</span>
                {filteredFailed.length > 0 ? (
                  <span className={css.failedCount}>{filteredFailed.length} {t('failedCountLabel')}</span>
                ) : null}
              </p>
              {globalEffectiveOpen && globalCount > 0 ? (
                <ul className={css.cards} id={`${sectionId}-global`}>
                  {filteredFailed.map(entry => globalRowCard(entry))}
                  {filteredRegular.map(entry => globalRowCard(
                    entry,
                    entry.enabled ? undefined : enabledIn.get(entry.moduleName),
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
