/**
 * Personal, local-first Agent modes.
 *
 * The service owns the durable mode selection and enforces the same policy at
 * both model presentation and tool execution boundaries. Hiding a schema is
 * never treated as a permission check.
 *
 * @module @deepseek-ai/dsh-personal-agent
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Message } from '@deepseek-ai/dsh-llm'
import { estimateMessage, estimateToolsTokens } from '@deepseek-ai/dsh-token-meter'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'

export const AGENT_MODE_SETTINGS_NAMESPACE = 'personal-agent'

export const AGENT_MODES = ['qa', 'research', 'coding', 'execution'] as const
export type AgentMode = typeof AGENT_MODES[number]

export interface ModePolicy {
  mode: AgentMode
  visibleTools: readonly string[]
  maxSteps: number
  maxToolResultBytes: number
  maxContextTokens: number
  historyTurns: number
  knowledgeBase: 'off' | 'explicit'
  approval: 'ask' | 'never'
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
}

export interface ModeOption {
  value: AgentMode
  name: string
  description: string
  maxSteps: number
  maxContextTokens: number
}

export interface ModeView {
  mode: AgentMode
  policy: ModePolicy
}

export type AgentTaskStatus = 'created' | 'planned' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'cancelled'

export interface AgentTaskBudget {
  maxSteps: number
  maxTokens?: number | undefined
  maxDepth?: number | undefined
  maxConcurrent?: number | undefined
  timeoutMs?: number | undefined
}

export interface AgentTaskSnapshot {
  id: string
  goal: string
  status: AgentTaskStatus
  owner: string
  turn: number
  parentTask?: string | undefined
  budget: AgentTaskBudget
  acceptance?: string[] | undefined
  artifacts?: string[] | undefined
  error?: string | undefined
  createdAt: number
  updatedAt: number
}

export interface ToolPolicyAudit {
  name: string
  reason: string
}

export interface Config {
  defaultMode?: AgentMode
  modes?: Partial<Record<AgentMode, Partial<Omit<ModePolicy, 'mode'>>>>
}

export interface AgentModeSettings {
  defaultMode: AgentMode
}

export const AGENT_MODE_SETTINGS_SCHEMA: schema<AgentModeSettings> = schema.object({
  defaultMode: schema.union(AGENT_MODES).default('qa'),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    personalAgent: PersonalAgentService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable current personal Agent mode. The latest event wins. */
    'agent/mode': { mode: AgentMode }
    /** Informational audit of one bounded request snapshot. */
    'agent/request-context': {
      turn: number
      step: number
      mode: AgentMode
      maxSteps: number
      usedSteps: number
      inputMessages: number
      outputMessages: number
      clippedToolResults: number
      droppedMessages: number
      /** Heuristic input composition, recorded per model request. */
      systemPromptTokens?: number
      toolSchemaTokens?: number
      historyTokens?: number
      knowledgeBaseTokens?: number
      skillTokens?: number
      toolResultTokens?: number
      estimatedInputTokens?: number
      outputBudgetTokens?: number
      deduplicatedMessages?: number
      hiddenTools?: ToolPolicyAudit[]
    }
    /** Audit of a tool call rejected by the active personal mode policy. */
    'agent/tool-denied': {
      turn: number
      step: number
      name: string
      code: string
      reason: string
    }
    /** Durable task lifecycle event emitted when a turn task is created. */
    'task/created': AgentTaskSnapshot
    /** Durable task lifecycle event emitted after a user goal is captured. */
    'task/planned': AgentTaskSnapshot
    /** Durable task lifecycle event emitted when task execution starts. */
    'task/running': AgentTaskSnapshot
    /** Durable task lifecycle event emitted while human approval is pending. */
    'task/waiting-human': AgentTaskSnapshot
    /** Durable task lifecycle event emitted after successful completion. */
    'task/succeeded': AgentTaskSnapshot
    /** Durable task lifecycle event emitted after a task failure. */
    'task/failed': AgentTaskSnapshot
    /** Durable task lifecycle event emitted after cancellation. */
    'task/cancelled': AgentTaskSnapshot
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    personalAgentMode: { mode: AgentMode; maxSteps: number }
    personalAgentTask: { current: AgentTaskSnapshot | null }
  }
  interface SessionProjectionMap {
    personalAgentMode: { mode: AgentMode; maxSteps: number }
    personalAgentTask: AgentTaskSnapshot | null
  }
}

const MODE_NAMES: Record<AgentMode, string> = {
  qa: '问答',
  research: '研究',
  coding: '编码',
  execution: '执行 / 媒体',
}

const MODE_DESCRIPTIONS: Record<AgentMode, string> = {
  qa: '直接回答，不加载编码和执行工具。',
  research: '允许只读检索、知识库和网页研究。',
  coding: '允许读写项目、运行测试，并对写入操作进行确认。',
  execution: '按需使用媒体、服务和本机执行能力。',
}

const DEFAULT_POLICIES: Record<AgentMode, ModePolicy> = {
  qa: {
    mode: 'qa', visibleTools: [], maxSteps: 0, maxToolResultBytes: 0, maxContextTokens: 12_000,
    historyTurns: 6, knowledgeBase: 'explicit', approval: 'ask', sandbox: 'read-only',
  },
  research: {
    mode: 'research',
    visibleTools: ['read', 'glob', 'grep', 'web_search', 'web_fetch', 'knowledge_list', 'knowledge_search', 'tool_search', 'skill', 'ask_user_question'],
    maxSteps: 6, maxToolResultBytes: 8_000, maxContextTokens: 24_000, historyTurns: 8,
    knowledgeBase: 'explicit', approval: 'ask', sandbox: 'read-only',
  },
  coding: {
    mode: 'coding',
    visibleTools: ['read', 'glob', 'grep', 'write', 'edit', 'bash', 'pwsh', 'job_output', 'job_kill', 'run_in_background', 'read_image', 'skill', 'tool_search', 'ask_user_question', 'todo_write', 'present', 'knowledge_list', 'knowledge_search'],
    maxSteps: 16, maxToolResultBytes: 8_000, maxContextTokens: 32_000, historyTurns: 12,
    knowledgeBase: 'explicit', approval: 'ask', sandbox: 'workspace-write',
  },
  execution: {
    // Full-tool mode: a media or service task easily needs more rounds than
    // the read-only research ceiling, so it matches coding's step cap.
    mode: 'execution', visibleTools: ['*'], maxSteps: 16, maxToolResultBytes: 8_000, maxContextTokens: 24_000,
    historyTurns: 6, knowledgeBase: 'explicit', approval: 'ask', sandbox: 'workspace-write',
  },
}

const modeSchema = z.enum(AGENT_MODES)
const modeStateSchema = z.object({ mode: modeSchema })
const taskStatusSchema = z.enum(['created', 'planned', 'running', 'waiting-human', 'succeeded', 'failed', 'cancelled'] as const)
const taskSnapshotSchema = z.object({
  id: z.string(),
  goal: z.string(),
  status: taskStatusSchema,
  owner: z.string(),
  turn: z.number().int().nonnegative(),
  parentTask: z.string().optional(),
  budget: z.object({
    maxSteps: z.number().int().nonnegative(),
    maxTokens: z.number().int().positive().optional(),
    maxDepth: z.number().int().nonnegative().optional(),
    maxConcurrent: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  acceptance: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
  error: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})
const taskProjectionStateSchema = z.object({ current: taskSnapshotSchema.nullable() })

const TASK_EVENT_STATUS: Readonly<Record<string, AgentTaskStatus>> = {
  'task/created': 'created',
  'task/planned': 'planned',
  'task/running': 'running',
  'task/waiting-human': 'waiting-human',
  'task/succeeded': 'succeeded',
  'task/failed': 'failed',
  'task/cancelled': 'cancelled',
}

function taskProjectionApply(
  state: { current: AgentTaskSnapshot | null },
  event: SessionEvent,
): { current: AgentTaskSnapshot | null } {
  return TASK_EVENT_STATUS[event.type] === undefined
    ? state
    : { current: event.data as AgentTaskSnapshot }
}

const taskProjectionDefinition = {
  key: 'personalAgentTask' as const,
  stateVersion: 1,
  stateSchema: taskProjectionStateSchema,
  init: (): { current: AgentTaskSnapshot | null } => ({ current: null }),
  apply: taskProjectionApply,
  wire: {
    viewSchema: taskSnapshotSchema.nullable(),
    view: (state: { current: AgentTaskSnapshot | null }) => state.current,
  },
} satisfies ProjectionDefinition<'personalAgentTask', { current: AgentTaskSnapshot | null }>

function validMode(value: string): value is AgentMode {
  return (AGENT_MODES as readonly string[]).includes(value)
}

/** Local-only, token-free mode suggestion for UI and future input surfaces. */
export function suggestMode(input: string): AgentMode | undefined {
  const text = input.toLowerCase()
  if (/(生成.{0,4}(图片|图像)|语音|音频|启动服务|停止服务|部署|执行命令|删除文件)/u.test(text)) return 'execution'
  if (/(修改|重构|修复|实现|编写|代码|文件|测试|git|typescript|javascript|python)/u.test(text)) return 'coding'
  if (/(搜索|调研|研究|资料|网页|来源|对比|查找)/u.test(text)) return 'research'
  return undefined
}

function clonePolicy(mode: AgentMode, override: Partial<Omit<ModePolicy, 'mode'>> | undefined): ModePolicy {
  const base = DEFAULT_POLICIES[mode]
  // A present-but-undefined key must not shadow the built-in: `...override`
  // would otherwise write undefined over a real budget and silently disable
  // that bound for the mode.
  const defined = Object.fromEntries(
    Object.entries(override ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<ModePolicy>
  return {
    ...base,
    ...defined,
    mode,
    visibleTools: [...defined.visibleTools ?? base.visibleTools],
  }
}

function modeOfEvent(event: SessionEvent): AgentMode | undefined {
  return event.type === 'agent/mode' ? event.data.mode : undefined
}

function estimateContextTokens(value: Message): number {
  return estimateMessage(value)
}

function isKnowledgeContext(message: Message): boolean {
  return message.source.kind === 'plugin'
    && (message.source.plugin === 'knowledge-auto-retrieval' || message.source.plugin === 'knowledge')
}

function isSkillContext(message: Message): boolean {
  const kind = (message.source as { kind: string }).kind
  return kind === 'skill-invocation' || kind === 'skill-catalog'
}

function isToolResultMessage(message: Message): boolean {
  return message.source.kind === 'tool'
    || message.content.some(content => content.type === 'tool-result')
}

function isCurrentUserMessage(message: Message): boolean {
  return message.role === 'user' && message.source.kind === 'user' && !isToolResultMessage(message)
}

/** Return the top-level tool calls carried by one assistant message. */
function toolCallIds(message: Message): string[] {
  if (message.role !== 'assistant') return []
  return message.content
    .filter((content): content is Extract<typeof content, { type: 'tool-call' }> => content.type === 'tool-call')
    .map(content => String(content.id))
}

/** Return the top-level tool results carried by one user message. */
function toolResultIds(message: Message): string[] {
  return message.content
    .filter((content): content is Extract<typeof content, { type: 'tool-result' }> => content.type === 'tool-result')
    .map(content => String(content.toolCallId))
}

function duplicateKey(message: Message): string | undefined {
  if (isToolResultMessage(message)) {
    return JSON.stringify(message.content.map(content => content.type === 'tool-result'
      ? { ...content, toolCallId: undefined }
      : content))
  }
  if (message.source.kind === 'plugin' && (message.source.form === 'catalog' || isKnowledgeContext(message))) {
    return `${message.source.plugin}:${JSON.stringify(message.content)}`
  }
  if (isSkillContext(message)) return `skill:${JSON.stringify(message.content)}`
  return undefined
}

function markDuplicate(message: Message): Message {
  if (isToolResultMessage(message)) {
    return {
      ...message,
      content: message.content.map(content => content.type === 'tool-result'
        ? { ...content, content: [{ type: 'text', text: '[重复工具结果已省略]' }] }
        : content),
    }
  }
  return { ...message, content: [{ type: 'text', text: '[重复上下文已省略]' }] }
}

interface ContextBudgetResult {
  messages: Message[]
  clippedToolResults: number
  deduplicatedMessages: number
}

/** Runtime service enforcing personal modes for each Agent session. */
export class PersonalAgentService extends TypertRemoteService {
  static inject = ['sessionProjections', 'sessions', 'systemPrompt']

  static Config: schema<Config> = schema.object({
    defaultMode: schema.union(AGENT_MODES).default('qa'),
    // Every omitted field must stay omitted: schemastery otherwise
    // materializes an unspecified array as [] and keeps undefined numeric
    // keys, and the policy merge cannot tell either apart from an explicit
    // override. Overriding only `maxSteps` used to erase a mode's whole
    // built-in tool list. The `as never` casts only satisfy the fluent
    // default() signature, which is typed for a present value.
    modes: schema.dict(schema.object({
      visibleTools: schema.array(schema.string()).default(undefined as never),
      maxSteps: schema.number().step(1).min(0).default(undefined as never),
      maxToolResultBytes: schema.number().step(1).min(0).default(undefined as never),
      maxContextTokens: schema.number().step(1).min(1).default(undefined as never),
      historyTurns: schema.number().step(1).min(1).default(undefined as never),
      knowledgeBase: schema.union(['off', 'explicit'] as const),
      approval: schema.union(['ask', 'never'] as const),
      sandbox: schema.union(['read-only', 'workspace-write', 'danger-full-access'] as const),
    })).default({}),
  }) as schema<Config>

  private readonly policies: Record<AgentMode, ModePolicy>
  private readonly rootCtx: Context
  private defaultSettings: () => AgentModeSettings
  /**
   * Per-turn step-budget state. `count` holds charged model rounds and
   * `countedStep` is the step that paid for the current round, so every
   * parallel call inside one step shares a single charge.
   */
  private readonly steps = new WeakMap<Session, { turn: number; step: number; countedStep: number | null; count: number }>()
  private readonly tasks = new WeakMap<Session, AgentTaskSnapshot>()
  private readonly owners = new WeakMap<Session, string>()
  private readonly taskEventQueues = new WeakMap<Session, Promise<void>>()
  /** Mode captured at turn start; a UI switch never changes an active loop. */
  private readonly activeModes = new WeakMap<Session, AgentMode>()
  /** Last schema visibility decision for the currently assembling step. */
  private readonly toolPolicyAudits = new WeakMap<Session, { turn: number; step: number; hiddenTools: ToolPolicyAudit[] }>()
  /** Existing preset compositions retain their historical tool behavior until a mode is chosen. */
  private readonly unmanagedSessions = new WeakSet<Session>()
  private readonly managedSessions = new WeakSet<Session>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'personalAgent')
    this.rootCtx = ctx
    const baseSettings: AgentModeSettings = { defaultMode: config.defaultMode ?? 'qa' }
    this.defaultSettings = () => baseSettings
    this.policies = Object.fromEntries(AGENT_MODES.map(mode => [mode, clonePolicy(mode, config.modes?.[mode])])) as Record<AgentMode, ModePolicy>

    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, AGENT_MODE_SETTINGS_NAMESPACE, AGENT_MODE_SETTINGS_SCHEMA, baseSettings, {
        setSource: (current) => { this.defaultSettings = current },
        onChange: () => {},
      })
    })

    ctx.sessionProjections.register({
      key: 'personalAgentMode',
      stateVersion: 2,
      stateSchema: modeStateSchema.extend({ maxSteps: z.number().int().nonnegative() }),
      init: () => ({ mode: this.defaultMode, maxSteps: this.policies[this.defaultMode].maxSteps }),
      apply: (state, event) => {
        const mode = modeOfEvent(event)
        return mode === undefined ? state : { mode, maxSteps: this.policies[mode].maxSteps }
      },
      wire: {
        viewSchema: modeStateSchema.extend({ maxSteps: z.number().int().nonnegative() }),
        view: state => state,
      },
    })
    ctx.sessionProjections.register(taskProjectionDefinition)

    // Wait until the Agent is published: preset setup runs between session
    // creation and agent/created, so deciding at session/created would hide a
    // legacy preset's tools before its composition is known.
    ctx.on('session/created', (session) => {
      if (this.rootCtx.get('agentPresets') === undefined) this.pinInitialMode(session, this.inheritedMode(session))
    })
    ctx.on('agent/created', ({ agent }) => {
      this.owners.set(agent.session, agent.id)
      const presets = this.rootCtx.get('agentPresets') as { composedPreset?: (agentCtx: Context) => string | undefined } | undefined
      const inheritedMode = this.inheritedMode(agent.session)
      if (inheritedMode === undefined && (presets?.composedPreset?.(agent.ctx) !== undefined || agent.session.header.agentPreset !== undefined)) {
        this.unmanagedSessions.add(agent.session)
        return
      }
      if (inheritedMode !== undefined) this.managedSessions.add(agent.session)
      this.pinInitialMode(agent, inheritedMode)
    })

    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/start') {
        this.steps.set(session, { turn: event.data.turn, step: 0, countedStep: null, count: 0 })
        this.activeModes.set(session, this.currentForSession(session))
        this.startTask(session, event.data.turn)
      } else if (event.type === 'user/message') {
        this.planTask(session, event.data)
      } else if (event.type === 'step/start') {
        const current = this.steps.get(session)
        if (current?.turn === event.data.turn) current.step = event.data.step
        this.updateTaskStatus(session, event.data.turn, 'running')
      } else if (event.type === 'approval/asked') {
        this.updateTaskStatus(session, this.steps.get(session)?.turn, 'waiting-human')
      } else if (event.type === 'approval/decided') {
        const task = this.tasks.get(session)
        if (task?.status === 'waiting-human') {
          const rejected = event.data.outcome === 'rejected' || event.data.outcome === 'cancelled'
          this.updateTaskStatus(session, task.turn, rejected ? 'failed' : 'running', rejected ? `审批${event.data.outcome}` : undefined)
        }
      } else if (event.type === 'tool/call') {
        // maxSteps bounds model rounds, not individual calls. One step may
        // dispatch many parallel calls and still be a single round, so charge
        // only the first call of each step. Per-call charging let one batched
        // step exhaust the whole budget and reject the loop mid-task.
        const current = this.steps.get(session)
        if (current?.turn === event.data.turn && current.countedStep !== event.data.step) {
          current.countedStep = event.data.step
          current.count++
        }
      } else if (event.type === 'turn/end') {
        const status = event.data.reason.kind === 'completed' ? 'succeeded'
          : event.data.reason.kind === 'aborted' ? 'cancelled' : 'failed'
        const error = event.data.reason.kind === 'error' ? event.data.reason.error.message
          : event.data.reason.kind === 'max-tokens' ? '达到输出 Token 上限'
            : event.data.reason.kind === 'blocked' ? '任务被策略阻止' : undefined
        this.updateTaskStatus(session, event.data.turn, status, error)
        this.activeModes.delete(session)
      }
    })
    ctx.on('session/flush', async (session) => {
      await this.taskEventQueues.get(session)
    })

    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const transformed = await next()
      const agent = context.agent
      if (agent === undefined) return transformed
      if (!this.isManaged(agent)) return transformed
      const policy = this.policy(agent.session)
      if (policy.visibleTools.includes('*')) return transformed
      const allowed = new Set(policy.visibleTools)
      const position = this.steps.get(agent.session)
      if (position !== undefined) {
        this.toolPolicyAudits.set(agent.session, {
          turn: position.turn,
          // Prompt assembly runs before the loop publishes step/start for the
          // proposed request. The current counter therefore points at the
          // previous request; bind the audit to the step about to be admitted.
          step: position.step + 1,
          hiddenTools: transformed.tools
            .filter(tool => !allowed.has(tool.name))
            .map(tool => ({
              name: tool.name,
              reason: `当前${MODE_NAMES[policy.mode]}模式不允许此工具，模型不会收到它的定义。`,
            })),
        })
      }
      return {
        ...transformed,
        tools: transformed.tools.filter(tool => allowed.has(tool.name)),
        sections: transformed.sections.filter(section => !section.name.startsWith('tool:') || allowed.has(section.name.slice(5))),
      } satisfies PromptAssembly
    }, { prepend: true })

    ctx.on('tools/pre-execute', (exec, next): Promise<PreToolDecision> => {
      const agent = exec.agent
      if (agent === undefined) return next()
      if (!this.isManaged(agent)) return next()
      const policy = this.policy(agent.session)
      if (!policy.visibleTools.includes('*') && !policy.visibleTools.includes(exec.name)) {
        this.recordToolDenied(agent.session, exec.name, 'MODE_TOOL_DENIED', `工具「${exec.name}」不在当前${MODE_NAMES[policy.mode]}模式的允许范围内，请切换模式后重试。`)
        return Promise.resolve({
          kind: 'deny',
          reason: `工具「${exec.name}」不在当前${MODE_NAMES[policy.mode]}模式的允许范围内，请切换模式后重试。`,
          info: { name: 'PersonalAgentModeError', code: 'MODE_TOOL_DENIED' },
        })
      }
      const rounds = this.steps.get(agent.session)?.count ?? 0
      // The durable tool/call event is observed before pre-execute, so this
      // round is already charged. Deny only the round after the configured cap.
      if (rounds > policy.maxSteps) {
        this.recordToolDenied(agent.session, exec.name, 'MODE_STEP_LIMIT', `当前${MODE_NAMES[policy.mode]}模式已达到本轮工具步骤上限（${policy.maxSteps}）。请整理结果或切换模式后继续。`)
        return Promise.resolve({
          kind: 'deny',
          reason: `当前${MODE_NAMES[policy.mode]}模式已达到本轮工具步骤上限（${policy.maxSteps}）。请整理结果或切换模式后继续。`,
          info: { name: 'PersonalAgentBudgetError', code: 'MODE_STEP_LIMIT' },
        })
      }
      return next()
    }, { prepend: true })

    ctx.on('agent/pre-step', ({ agent, step }, next): Promise<PreStepDecision> => {
      if (!this.isManaged(agent)) return next()
      const policy = this.policy(agent.session)
      // maxSteps counts tool rounds; one extra model step is allowed to summarize.
      if (step > policy.maxSteps + 1) return Promise.resolve({ kind: 'reject' })
      return next()
    }, { prepend: true })

    ctx.on('agent/request-context', async ({ agent, turn, step }, next) => {
      const transformed = await next()
      // Preset sessions deliberately remain outside the personal policy until
      // the user selects a mode. Do not emit a misleading QA budget audit for
      // those sessions or for their unmanaged descendants.
      if (!this.isManaged(agent)) return transformed
      const policy = this.policy(agent.session)
      const boundedResult = this.limitContext(agent.session, transformed, turn, policy)
      const bounded = boundedResult.messages
      const context = this.contextBreakdown(agent.session, bounded)
      const toolAudit = this.toolPolicyAudits.get(agent.session)
      agent.session.append('agent/request-context', {
        turn,
        step,
        mode: policy.mode,
        maxSteps: policy.maxSteps,
        usedSteps: this.steps.get(agent.session)?.count ?? 0,
        inputMessages: transformed.length,
        outputMessages: bounded.length,
        clippedToolResults: boundedResult.clippedToolResults,
        droppedMessages: Math.max(0, transformed.length - bounded.length),
        ...context,
        ...(toolAudit?.turn === turn && toolAudit.step === step
          ? { hiddenTools: toolAudit.hiddenTools }
          : {}),
        deduplicatedMessages: boundedResult.deduplicatedMessages,
      }, { ignorable: true })
      return bounded
    }, { prepend: true })

    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        definitionId: CommandDefinitionId('@deepseek-ai/dsh-personal-agent'),
        name: 'mode',
        description: '切换个人 Agent 工作模式',
        input: { hint: '<qa|research|coding|execution>' },
        handler: ({ agent, rawInput }) => {
          const input = rawInput.trim()
          if (input === '') return { kind: 'success', text: `当前模式：${MODE_NAMES[this.current(agent)]}（${this.current(agent)}）` }
          const value = input as AgentMode
          if (!validMode(value)) return { kind: 'error', text: `未知模式「${value}」，可选：${AGENT_MODES.join('、')}` }
          this.set(agent, value)
          return { kind: 'success', text: `已切换到${MODE_NAMES[value]}模式` }
        },
      })
    })

    ctx.systemPrompt.section({
      name: 'personal-agent:mode',
      order: ctx.systemPrompt.getSectionOrder('PLAN_POLICY') - 10,
      text: context => context.agent === undefined ? '' : `当前个人 Agent 模式：${MODE_NAMES[this.current(context.agent)]}。只使用该模式允许的能力；需要其他能力时先建议用户切换模式。`,
    })
  }

  /** Return the selectable modes and their tool-step caps.
   * @returns Mode options.
   */
  @Remote('modes')
  modes(): ModeOption[] {
    return AGENT_MODES.map(mode => ({
      value: mode,
      name: MODE_NAMES[mode],
      description: MODE_DESCRIPTIONS[mode],
      maxSteps: this.policies[mode].maxSteps,
      maxContextTokens: this.policies[mode].maxContextTokens,
    }))
  }

  /** Return the current Agent's durable mode and policy.
   * @param agent - Current Agent selected by the Remote context.
   * @returns Its durable mode and policy.
   */
  @Remote('current')
  currentRemote(agent: Agent): ModeView {
    return { mode: this.current(agent), policy: { ...this.policy(agent.session), visibleTools: [...this.policy(agent.session).visibleTools] } }
  }

  /** Suggest a mode from draft text without a model call.
   * @param input - Draft user input.
   * @returns A local mode suggestion, or null.
   */
  @Remote('suggest')
  suggest(input: string): { mode: AgentMode | null } {
    return { mode: suggestMode(input) ?? null }
  }

  /** Set the mode for subsequent requests.
   * @param agent - Current Agent selected by the Remote context.
   * @param mode - Next-turn mode.
   * @returns The updated view.
   */
  @Remote('set')
  setRemote(agent: Agent, mode: AgentMode): ModeView {
    if (!validMode(mode)) throw new Error(`unknown personal Agent mode: ${mode}`)
    this.set(agent, mode)
    return this.currentRemote(agent)
  }

  /** Read an Agent's durable mode.
   * @param agent - Agent whose durable mode is read.
   * @returns The current mode.
   */
  current(agent: Agent): AgentMode {
    return this.currentForSession(agent.session)
  }

  private currentForSession(session: Session): AgentMode {
    const state = this.ctx.sessionProjections.stateOf(session, 'personalAgentMode')
    return state?.mode ?? this.defaultMode
  }

  /** Resolve the policy selected by a session's mode.
   * @param session - Session whose durable mode selects a policy.
   * @returns The effective policy.
   */
  policy(session: Session): ModePolicy {
    return this.policies[this.activeModes.get(session) ?? this.currentForSession(session)]
  }

  /** Return the mode context ceiling without applying it to legacy preset sessions. */
  contextBudget(session: Session): number | undefined {
    if (this.unmanagedSessions.has(session)) return undefined
    return this.policy(session).maxContextTokens
  }

  /**
   * Answer the capability question used by late tool-discovery adapters.
   *
   * Schema filtering happens in this service too, but discovery is allowed to
   * run after another prompt listener and could otherwise re-add a hidden
   * schema. Keeping this small public predicate lets those adapters apply the
   * same mode ceiling without depending on the concrete service class.
   * @param session - Session whose active mode is checked.
   * @param name - Tool name to authorize.
   * @returns Whether the tool is visible and executable in that mode.
   */
  allowsTool(session: Session, name: string): boolean {
    if (this.unmanagedSessions.has(session)) return true
    const visible = this.policy(session).visibleTools
    return visible.includes('*') || visible.includes(name)
  }

  /** Record a durable mode switch and apply its permissions.
   * @param agent - Agent whose session records the switch.
   * @param mode - Mode applied to future requests.
   */
  set(agent: Agent, mode: AgentMode): void {
    this.managedSessions.add(agent.session)
    this.unmanagedSessions.delete(agent.session)
    const hasModeEvent = agent.session.snapshotEvents().some(event => event.type === 'agent/mode')
    if (!hasModeEvent || this.current(agent) !== mode) {
      agent.session.append('agent/mode', { mode })
    }
    this.applyModePermissions(agent.session, mode)
  }

  private get defaultMode(): AgentMode {
    const value = this.defaultSettings().defaultMode
    return validMode(value) ? value : 'qa'
  }

  /** Keep the mode policy and the existing permission/sandbox services aligned. */
  private applyModePermissions(session: Session, mode: AgentMode): void {
    const policy = this.policies[mode]
    const permissionPresets = this.ctx.get('permissionPresets') as {
      names: readonly string[]
      resolve: (name: string) => { sandbox: SandboxMode; approval: ApprovalPolicy }
      set: (session: Session, name: string) => void
    } | undefined
    const matchingPreset = permissionPresets?.names.find((name) => {
      try {
        const spec = permissionPresets.resolve(name)
        return spec.sandbox === policy.sandbox && spec.approval === policy.approval
      } catch { return false }
    })
    if (matchingPreset !== undefined) {
      permissionPresets?.set(session, matchingPreset)
      return
    }
    // A deployment may configure a custom mode without a matching preset.
    // Write the canonical policy events directly so the mode still enforces
    // its declared sandbox and approval boundary.
    setSandboxMode(session, policy.sandbox)
    setApprovalPolicy(session, policy.approval)
  }

  /** Choose a bounded request snapshot while leaving the durable transcript intact. */
  private limitContext(session: Session, messages: Message[], turn: number, policy: ModePolicy): ContextBudgetResult {
    // When the global router is mounted, it owns history selection and the
    // provider-aware token budget. Keep this layer's tool-result clipping and
    // deduplication, but do not silently apply a second history cutoff.
    const routerActive = (this.rootCtx.get('contextRouter') as { active?: boolean } | undefined)?.active === true
    let source: Message[]
    if (routerActive) {
      source = messages
    } else {
      const cutoff = Math.max(1, turn - policy.historyTurns + 1)
      const events = session.snapshotEvents()
      const nodeTurns = new Map<number, number>()
      let activeTurn = 0
      for (const event of events) {
        if (event.type === 'turn/start') activeTurn = event.data.turn
        if (session.surface.nodes.includes(event.seq)) nodeTurns.set(Number(event.seq), activeTurn)
      }
      const selected = new Set<string>()
      for (const seq of session.surface.nodes) {
        const event = events[Number(seq)]
        if (event === undefined) continue
        const message = session.deriveEventMessage(event)
        if (message !== null && (event.type === 'system/message' || (nodeTurns.get(Number(seq)) ?? turn) >= cutoff)) {
          selected.add(String(message.id))
        }
      }
      const retained = messages.filter(message => selected.has(String(message.id)))
      source = retained.length === 0 ? messages.slice(-1) : retained
    }
    const currentUser = messages.findLast(isCurrentUserMessage)
    // Retrieval and policy notices are appended after the human message. If
    // projection selection omitted that message, put it back before the
    // budget pass so the current request cannot disappear silently.
    const withCurrentUser = currentUser !== undefined && !source.includes(currentUser)
      ? [...source, currentUser]
      : source
    const clipped = withCurrentUser.map(message => this.clipToolResult(message, policy.maxToolResultBytes))
    const deduped = this.deduplicateContext(clipped)
    const bounded = routerActive
      ? { messages: deduped.messages, dropped: 0 }
      : this.boundContextTokens(deduped.messages, policy.maxContextTokens)
    return {
      messages: bounded.messages,
      clippedToolResults: clipped.filter((message, index) => message !== withCurrentUser[index]).length,
      deduplicatedMessages: deduped.count + bounded.dropped,
    }
  }

  private deduplicateContext(messages: Message[]): { messages: Message[]; count: number } {
    const seen = new Set<string>()
    let count = 0
    const result = messages.map((message) => {
      const key = duplicateKey(message)
      if (key === undefined || !seen.has(key)) {
        if (key !== undefined) seen.add(key)
        return message
      }
      count++
      return markDuplicate(message)
    })
    return { messages: result, count }
  }

  private boundContextTokens(messages: Message[], maxTokens: number): { messages: Message[]; dropped: number } {
    if (messages.length === 0) return { messages: [], dropped: 0 }

    // A provider tool output is only valid when its assistant tool call is in
    // the same request. Treat each assistant-call/result round as one atomic
    // budget unit. A reverse message walk can otherwise retain a large result
    // while dropping its much smaller call, which OpenAI rejects as an
    // "orphaned tool output".
    const ownerByCall = new Map<string, number>()
    const parent = messages.map((_message, index) => index)
    const find = (index: number): number => {
      let root = index
      while (parent[root] !== root) root = parent[root] as number
      while (parent[index] !== index) {
        const next = parent[index] as number
        parent[index] = root
        index = next
      }
      return root
    }
    const union = (left: number, right: number): void => {
      const leftRoot = find(left)
      const rightRoot = find(right)
      if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
    }
    const orphanResults = new Set<number>()
    messages.forEach((message, index) => {
      if (message.role === 'assistant') {
        for (const callId of toolCallIds(message)) ownerByCall.set(callId, index)
        return
      }
      const resultIds = toolResultIds(message)
      if (resultIds.length === 0) return
      const owners = new Set<number>()
      for (const callId of resultIds) {
        const owner = ownerByCall.get(callId)
        if (owner === undefined) orphanResults.add(index)
        else owners.add(owner)
      }
      for (const owner of owners) union(owner, index)
    })

    const units = new Map<number, number[]>()
    messages.forEach((_message, index) => {
      if (orphanResults.has(index)) return
      const root = find(index)
      const unit = units.get(root)
      if (unit === undefined) units.set(root, [index])
      else unit.push(index)
    })

    // A call without a result is just as invalid as a result without a call
    // for a replay request. Exclude that incomplete round from candidates.
    const incompleteUnits = new Set<number>()
    for (const [root, unit] of units) {
      const calls = unit.flatMap(index => toolCallIds(messages[index] as Message))
      if (calls.length === 0) continue
      const results = new Set(unit.flatMap(index => toolResultIds(messages[index] as Message)))
      if (calls.some(callId => !results.has(callId))) incompleteUnits.add(root)
    }

    // The current user request is an invariant, not just another recent
    // message. Tool results and retrieval notices can be appended after it,
    // so a simple reverse walk could silently remove the request that the
    // model is supposed to answer. System instructions are also retained;
    // when an individual invariant exceeds the budget it is kept alone and
    // the audit exposes the resulting overshoot rather than dropping it.
    const required = new Set<number>()
    let currentUser = -1
    messages.forEach((message, index) => {
      if (message.role === 'system') required.add(index)
      if (isCurrentUserMessage(message)) currentUser = index
    })
    if (currentUser >= 0) required.add(currentUser)
    if (required.size === 0) required.add(messages.length - 1)
    for (const index of [...required]) {
      if (orphanResults.has(index) || incompleteUnits.has(find(index))) required.delete(index)
    }
    // If the final invariant is a tool result (for example a restored
    // request resumed immediately after tool execution), promote it to the
    // complete call/result unit instead of retaining only the output.
    for (const index of [...required]) {
      const unit = units.get(find(index))
      if (unit !== undefined) for (const unitIndex of unit) required.add(unitIndex)
    }

    let total = 0
    const kept = new Set<number>()
    for (const index of required) {
      const message = messages[index]
      if (message === undefined) continue
      kept.add(index)
      total += estimateContextTokens(message)
    }
    if (maxTokens > 0) {
      for (let index = messages.length - 1; index >= 0; index--) {
        if (kept.has(index)) continue
        if (orphanResults.has(index)) continue
        const root = find(index)
        if (incompleteUnits.has(root)) continue
        const unit = units.get(root) ?? [index]
        if (unit.some(unitIndex => kept.has(unitIndex))) continue
        const cost = unit.reduce((sum, unitIndex) => {
          const message = messages[unitIndex]
          return message === undefined ? sum : sum + estimateContextTokens(message)
        }, 0)
        if (total + cost > maxTokens) continue
        for (const unitIndex of unit) kept.add(unitIndex)
        total += cost
      }
    }
    // Required system/current-user messages can never be tool results. Keep
    // the final filter defensive in case a malformed session marks one as a
    // result after the required set was assembled.
    const bounded = messages.filter((_message, index) => kept.has(index) && !orphanResults.has(index))
    return { messages: bounded, dropped: messages.length - bounded.length }
  }

  private contextBreakdown(session: Session, messages: readonly Message[]): {
    systemPromptTokens: number
    toolSchemaTokens: number
    historyTokens: number
    knowledgeBaseTokens: number
    skillTokens: number
    toolResultTokens: number
    estimatedInputTokens: number
    outputBudgetTokens?: number
  } {
    let systemPromptTokens = 0
    let historyTokens = 0
    let knowledgeBaseTokens = 0
    let skillTokens = 0
    let toolResultTokens = 0
    for (const message of messages) {
      const tokens = estimateContextTokens(message)
      if (message.role === 'system') systemPromptTokens += tokens
      else if (isKnowledgeContext(message)) knowledgeBaseTokens += tokens
      else if (isSkillContext(message)) skillTokens += tokens
      else if (isToolResultMessage(message)) toolResultTokens += tokens
      else historyTokens += tokens
    }
    const toolSchemaTokens = estimateToolsTokens(session.requestHeader())
    const estimatedInputTokens = systemPromptTokens + toolSchemaTokens + historyTokens + knowledgeBaseTokens + skillTokens + toolResultTokens
    const maxTokens = session.requestHeader()?.config.maxTokens
    return {
      systemPromptTokens, toolSchemaTokens, historyTokens, knowledgeBaseTokens, skillTokens,
      toolResultTokens, estimatedInputTokens,
      ...(maxTokens === undefined ? {} : { outputBudgetTokens: maxTokens }),
    }
  }

  private startTask(session: Session, turn: number): void {
    const mode = this.activeModes.get(session) ?? this.currentForSession(session)
    const policy = this.policies[mode]
    const now = Date.now()
    const task: AgentTaskSnapshot = {
      id: `${String(session.id)}:${turn}`,
      goal: '等待用户请求',
      status: 'created',
      owner: this.owners.get(session) ?? String(session.id),
      turn,
      ...(session.header.parentSession === undefined ? {} : { parentTask: String(session.header.parentSession) }),
      budget: {
        maxSteps: policy.maxSteps,
        ...(session.requestHeader()?.config.maxTokens === undefined ? {} : { maxTokens: session.requestHeader()!.config.maxTokens }),
      },
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(session, task)
    this.appendTaskEvent(session, 'created', task)
  }

  private planTask(session: Session, message: Message): void {
    const task = this.tasks.get(session)
    if (task === undefined || task.status !== 'created' || message.source.kind !== 'user') return
    const goal = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim().slice(0, 4_000)
    if (!goal) return
    const next = { ...task, goal, status: 'planned' as const, updatedAt: Date.now() }
    this.tasks.set(session, next)
    this.appendTaskEvent(session, 'planned', next)
  }

  private updateTaskStatus(session: Session, turn: number | undefined, status: AgentTaskStatus, error?: string): void {
    const task = this.tasks.get(session)
    if (task === undefined || turn === undefined || task.turn !== turn) return
    if (task.status === status && error === undefined) return
    const next: AgentTaskSnapshot = {
      ...task,
      status,
      updatedAt: Date.now(),
      ...(error === undefined ? {} : { error: error.slice(0, 2_000) }),
    }
    this.tasks.set(session, next)
    this.appendTaskEvent(session, status, next)
  }

  private appendTaskEvent(session: Session, status: AgentTaskStatus, task: AgentTaskSnapshot): void {
    const options = { ignorable: true as const }
    const previous = this.taskEventQueues.get(session) ?? Promise.resolve()
    const next = previous.then(() => {
      switch (status) {
        case 'created': session.append('task/created', task, options); break
        case 'planned': session.append('task/planned', task, options); break
        case 'running': session.append('task/running', task, options); break
        case 'waiting-human': session.append('task/waiting-human', task, options); break
        case 'succeeded': session.append('task/succeeded', task, options); break
        case 'failed': session.append('task/failed', task, options); break
        case 'cancelled': session.append('task/cancelled', task, options); break
      }
    })
    this.taskEventQueues.set(session, next.catch(() => undefined))
  }

  private recordToolDenied(session: Session, name: string, code: string, reason: string): void {
    const current = this.steps.get(session)
    if (current === undefined) return
    session.append('agent/tool-denied', {
      turn: current.turn,
      step: current.step,
      name,
      code,
      reason,
    }, { ignorable: true })
  }

  private clipToolResult(message: Message, maxBytes: number): Message {
    if (maxBytes <= 0 || message.role !== 'user') return message
    let changed = false
    const content = message.content.map((block) => {
      if (block.type !== 'tool-result' || Buffer.byteLength(JSON.stringify(block), 'utf8') <= maxBytes) return block
      changed = true
      const raw = block.content.map(content => content.type === 'text' ? content.text : JSON.stringify(content)).join('\n')
      const budget = Math.max(64, maxBytes - 96)
      const head = raw.slice(0, Math.floor(budget * 0.65))
      const tail = raw.slice(-Math.floor(budget * 0.3))
      const clipped = `[工具结果已裁剪，原始内容 ${Buffer.byteLength(raw, 'utf8')} 字节]\n${head}\n…\n${tail}`
      return { ...block, content: [{ type: 'text' as const, text: clipped }] }
    })
    return changed ? { ...message, content } : message
  }

  private pinInitialMode(agentOrSession: Agent | Session, preferredMode?: AgentMode): void {
    const session = 'session' in agentOrSession ? agentOrSession.session : agentOrSession
    const state = this.ctx.sessionProjections.stateOf(session, 'personalAgentMode')
    const hasModeEvent = session.snapshotEvents().some(event => event.type === 'agent/mode')
    if (state?.mode === undefined || !hasModeEvent) {
      const mode = preferredMode ?? state?.mode ?? this.defaultMode
      session.append('agent/mode', { mode })
      this.applyModePermissions(session, mode)
    }
  }

  /** Resolve a personal mode inherited by a child of a managed session. */
  private inheritedMode(session: Session): AgentMode | undefined {
    const parentId = session.header.parentSession
    if (parentId === undefined) return undefined
    const parent = this.ctx.sessions.get(parentId)
    if (parent === undefined || this.unmanagedSessions.has(parent)) return undefined
    if (!this.managedSessions.has(parent) && parent.header.agentPreset !== undefined) return undefined
    return this.activeModes.get(parent) ?? this.currentForSession(parent)
  }

  private isManaged(agent: Agent): boolean {
    if (this.managedSessions.has(agent.session)) return true
    if (this.unmanagedSessions.has(agent.session)) return false

    const presets = this.rootCtx.get('agentPresets') as {
      composedPreset?: (agentCtx: Context) => string | undefined
    } | undefined
    if (presets?.composedPreset?.(agent.ctx) !== undefined || agent.session.header.agentPreset !== undefined) {
      this.unmanagedSessions.add(agent.session)
      return false
    }
    return true
  }

}

export default PersonalAgentService
