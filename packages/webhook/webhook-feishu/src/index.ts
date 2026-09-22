/** Feishu bot adapter: receive mobile chat messages and route them to Agents. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createLarkChannel, type LarkChannel } from '@larksuiteoapi/node-sdk'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-commands'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createFeishuWebhookHandler } from './handler.ts'
import { FeishuClient } from './feishu.ts'
import { executeFeishuControlCommand, resolveFeishuControlCommand } from './control-command.ts'
import type { FeishuMessageEvent } from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    feishu: {
      readonly kind: 'feishu'
      readonly source: string
      readonly eventId: string
      readonly form: 'notice'
      readonly summary: string
    }
  }
}

export type * from './types.ts'
export { FeishuClient, verifyFeishuSignature } from './feishu.ts'
export { parseFeishuEnvelope, parseFeishuMessage } from './parser.ts'
export { executeFeishuControlCommand, resolveFeishuControlCommand } from './control-command.ts'

export const name = 'webhook-feishu'
export const inject = [
  'webServer', 'credentials', 'agents', 'agentDefaultModel', 'agentPresets',
  'permissionPresets', 'sessionTitle', 'workspaceRegistry', 'commands',
]

/** Settings namespace exposed by the Feishu bot card in the Web UI. */
export const FEISHU_SETTINGS_NAMESPACE = 'webhook-feishu'

export interface Config {
  readonly transport: 'websocket' | 'webhook'
  readonly path: string
  readonly appIdEnv: string
  readonly appSecretEnv: string
  readonly verificationTokenEnv?: string
  readonly encryptKeyEnv?: string
  readonly workspacePath: string
  readonly agentPreset: string
  readonly permissionPreset: string
  readonly source: string
  readonly maxBodyBytes: number
  readonly requireMention: boolean
  readonly allowedOpenIds: string[]
  readonly model?: { provider: string; model: string; maxTokens?: number }
}

export const Config: z<Config> = z.object({
  transport: z.union(['websocket', 'webhook']).default('websocket'),
  path: z.string().default('/feishu'),
  appIdEnv: z.string().role('credential-ref').default('DSH_FEISHU_APP_ID'),
  appSecretEnv: z.string().role('credential-ref').default('DSH_FEISHU_APP_SECRET'),
  verificationTokenEnv: z.string().role('credential-ref').default(undefined as never),
  encryptKeyEnv: z.string().role('credential-ref').default(undefined as never),
  workspacePath: z.string().default('.'),
  agentPreset: z.string().default('standard'),
  permissionPreset: z.string().default('read-only'),
  source: z.string().default('primary-feishu'),
  maxBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1048576),
  requireMention: z.boolean().default(true),
  allowedOpenIds: z.array(String).default([]),
  model: z.object({
    provider: z.string().required(),
    model: z.string().required(),
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(undefined as never),
  }).default(undefined as never),
})

interface Binding {
  readonly key: string
  readonly receiveId: string
  readonly receiveIdType: 'chat_id' | 'open_id'
  readonly handle: AgentHandle
  readonly detachWorkspace: () => Promise<void>
}

function assertConfig(config: Config): void {
  if (!config.path.startsWith('/') || config.path === '/' || config.path.endsWith('/') || config.path.includes('?') || config.path.includes('#')) {
    throw new Error('webhook-feishu path must be an absolute non-root pathname without a trailing slash, query, or fragment')
  }
  if (config.transport === 'webhook' && config.verificationTokenEnv === undefined) {
    throw new Error('webhook-feishu verificationTokenEnv is required for webhook transport')
  }
  for (const [name, value] of Object.entries(config)) {
    if (name.endsWith('Env') && value !== undefined) credentialRef(value)
  }
  if (config.workspacePath.trim() === '') throw new Error('webhook-feishu workspacePath must be non-empty')
  if (config.source.trim() !== config.source || config.source === '') throw new Error('webhook-feishu source must be non-empty and trimmed')
}

function resolveWorkspacePath(path: string): string {
  return path === '.' ? process.cwd() : path
}

function messageText(event: SessionEvent): string | undefined {
  if (event.type !== 'assistant/message') return undefined
  return event.data.message.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim() || undefined
}

export function apply(ctx: Context, config: Config): void {
  ctx.logger.info(`webhook-feishu: plugin loaded (transport=${config.transport})`)
  assertConfig(config)
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, FEISHU_SETTINGS_NAMESPACE, Config, config, {
      applies: 'restart',
      setSource: (source) => { current = source },
      onChange: () => {},
      validate: assertConfig,
    })
  })
  const client = new FeishuClient(ctx, {
    appId: credentialRef(config.appIdEnv),
    appSecret: credentialRef(config.appSecretEnv),
    ...(config.verificationTokenEnv === undefined ? {} : { verificationToken: credentialRef(config.verificationTokenEnv) }),
    ...(config.encryptKeyEnv === undefined ? {} : { encryptKey: credentialRef(config.encryptKeyEnv) }),
  })
  const byKey = new Map<string, Binding>()
  const pending = new Map<string, Promise<Binding>>()
  const bySession = new Map<string, Binding>()
  const seenEvents = new Set<string>()
  let sendReply: (binding: Binding, text: string) => Promise<void> = async (binding, text) => {
    await client.sendMarkdownChunks({ receiveId: binding.receiveId, receiveIdType: binding.receiveIdType, text })
  }

  const logMessage = (stage: string, message: FeishuMessageEvent): void => {
    const detail = `webhook-feishu: ${stage} (event=${message.eventId}, message=${message.messageId}, chat=${message.chatId ?? '-'}, type=${message.chatType})`
    ctx.logger.info(detail)
  }

  const createBinding = async (message: FeishuMessageEvent): Promise<Binding> => {
    // Private chats are keyed by the sender so they remain stable even if a
    // Feishu client recreates the underlying p2p chat. Group chats use the
    // chat id because the session is shared by everyone in that chat.
    const receiveId = message.chatType === 'p2p'
      ? (message.openId ?? message.chatId)
      : (message.chatId ?? message.openId)
    if (receiveId === undefined) throw new Error('Feishu message has no reply target')
    const receiveIdType = message.chatType === 'p2p' && message.openId !== undefined ? 'open_id' : 'chat_id'
    const key = `${receiveIdType}:${receiveId}`
    const active = current()
    logMessage('creating Agent binding', message)
    const workspace = await ctx.workspaceRegistry.create(resolveWorkspacePath(active.workspacePath))
    const preset = await ctx.agentPresets.resolve(active.agentPreset)
    await ctx.agentPresets.standingKeyFor(preset.id)
    const selected = active.model ?? ctx.agentDefaultModel.currentSelection()
    const modelSelection: ModelSelection = { ...selected }
    const reasoningEffort = 'reasoningEffort' in selected ? selected.reasoningEffort : undefined
    const maxTokens = 'maxTokens' in selected ? selected.maxTokens : undefined
    const handle = await ctx.agents.create({
      sessionId: brandString<SessionId>(`feishu-${randomUUID()}`),
      meta: { cwd: workspace.path, agentPreset: preset.id },
      agentOptions: {
        provider: selected.provider,
        model: selected.model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
      },
      setup: async (agentCtx) => {
        await ctx.agentPresets.mount(agentCtx, preset.id)
        agentCtx.on('agent/request', async ({ agent }, next) => {
          const resolved = await next()
          if (
            agent.session.requestHeader() !== undefined
            || resolved.provider !== modelSelection.provider
            || resolved.model !== modelSelection.model
          ) return resolved
          const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
          return {
            ...withoutInheritedEffort,
            ...modelSelection.reasoningEffort === undefined ? {} : { reasoningEffort: modelSelection.reasoningEffort },
          }
        })
      },
    })
    ctx.logger.info(`webhook-feishu: Agent created (session=${handle.agent.session.id}, target=${key})`)
    let attached = false
    try {
      await workspace.attachSession(handle.agent.session.id)
      attached = true
      ctx.permissionPresets.set(handle.agent.session, active.permissionPreset)
      ctx.sessionTitle.rename(handle.agent.session, `飞书 ${receiveId}`)
      const binding: Binding = {
        key,
        receiveId,
        receiveIdType,
        handle,
        detachWorkspace: async () => {
          if (attached) await workspace.detachSession(handle.agent.session.id)
        },
      }
      byKey.set(key, binding)
      bySession.set(handle.agent.session.id, binding)
      ctx.logger.info(`webhook-feishu: Agent binding ready (session=${handle.agent.session.id}, target=${key})`)
      return binding
    } catch (error: unknown) {
      if (attached) await workspace.detachSession(handle.agent.session.id).catch(() => {})
      await handle.dispose().catch(() => {})
      throw error
    }
  }

  const dispatchMessage = async (message: FeishuMessageEvent): Promise<void> => {
    logMessage('dispatching message', message)
    if (seenEvents.has(message.eventId)) {
      ctx.logger.info(`webhook-feishu: duplicate message ignored (event=${message.eventId})`)
      return
    }
    seenEvents.add(message.eventId)
    if (seenEvents.size > 2048) seenEvents.delete(seenEvents.values().next().value as string)
    const sessionTarget = message.chatType === 'p2p'
      ? (message.openId ?? message.chatId)
      : (message.chatId ?? message.openId)
    if (sessionTarget === undefined) return
    const receiveIdType = message.chatType === 'p2p' && message.openId !== undefined ? 'open_id' : 'chat_id'
    const key = `${receiveIdType}:${sessionTarget}`
    let binding = byKey.get(key)
    if (binding === undefined) {
      let creation = pending.get(key)
      if (creation === undefined) {
        creation = createBinding(message)
        pending.set(key, creation)
      }
      try { binding = await creation } finally { pending.delete(key) }
    }
    if (resolveFeishuControlCommand(message.text) !== undefined) {
      try {
        const control = await executeFeishuControlCommand(
          ctx.commands,
          binding.handle.agent,
          message.text,
          new AbortController().signal,
        )
        if (control.text !== undefined && control.text !== '') await sendReply(binding, control.text)
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error)
        await sendReply(binding, `命令执行失败：${detail}`)
        ctx.logger.warn(`webhook-feishu: command failed (session=${binding.handle.agent.session.id}): ${detail}`)
        return
      }
      ctx.logger.info(`webhook-feishu: command consumed (session=${binding.handle.agent.session.id})`)
      return
    }
    binding.handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: message.text }],
      source: { kind: 'feishu', source: config.source, eventId: message.eventId, form: 'notice', summary: boundContextSummary(`Feishu message from ${sessionTarget}`) },
    }))
    ctx.logger.info(`webhook-feishu: Agent followup queued (session=${binding.handle.agent.session.id}, event=${message.eventId})`)
  }

  let route: WebRoute | undefined
  if (config.transport === 'webhook') {
    const verificationTokenEnv = config.verificationTokenEnv
    if (verificationTokenEnv === undefined) throw new Error('webhook-feishu verificationTokenEnv is required for webhook transport')
    route = {
      kind: 'exact', path: config.path,
      handler: createFeishuWebhookHandler(ctx, {
        verificationToken: credentialRef(verificationTokenEnv),
        ...(config.encryptKeyEnv === undefined ? {} : { encryptKey: credentialRef(config.encryptKeyEnv) }),
        maxBodyBytes: config.maxBodyBytes,
        requireMention: config.requireMention,
        allowedOpenIds: config.allowedOpenIds,
        onMessage: async (message) => { if (message !== null) await dispatchMessage(message) },
      }),
    }
  }
  const stopEvents = ctx.on('session/event', (session, event) => {
    const binding = bySession.get(session.id)
    const text = binding === undefined ? undefined : messageText(event)
    if (binding !== undefined && text !== undefined) {
      ctx.logger.info(`webhook-feishu: assistant message ready (session=${session.id}, chars=${text.length})`)
      void sendReply(binding, text).catch((error) => {
        ctx.logger.warn(`webhook-feishu: reply failed: ${String(error)}`)
      })
    }
  })
  const stopAgentErrors = ctx.on('agent/error', ({ agent, error }) => {
    const binding = bySession.get(agent.session.id)
    if (binding === undefined) return
    const detail = error instanceof Error ? error.message : String(error)
    ctx.logger.error(`webhook-feishu: Agent error (session=${agent.session.id}): ${detail}`)
    void sendReply(binding, `Agent 执行失败：${detail}`).catch((sendError) => {
      ctx.logger.warn(`webhook-feishu: error reply failed: ${String(sendError)}`)
    })
  })
  ctx.effect(() => {
    const unregister = route === undefined ? undefined : ctx.webServer.register(route)
    return async () => {
      unregister?.()
      stopEvents()
      stopAgentErrors()
      await Promise.all([...byKey.values()].map(async (binding) => {
        bySession.delete(binding.handle.agent.session.id)
        byKey.delete(binding.key)
        await binding.detachWorkspace().catch(() => {})
        await binding.handle.dispose().catch(() => {})
      }))
      pending.clear()
    }
  }, `webhook-feishu: ${config.path}`)

  if (config.transport === 'websocket') {
    ctx.inject(['credentials'], credentialsCtx => credentialsCtx.effect(async () => {
      const active = current()
      const appId = await credentialsCtx.credentials.resolve(credentialRef(active.appIdEnv))
      const appSecret = await credentialsCtx.credentials.resolve(credentialRef(active.appSecretEnv))
      if (appId === undefined || appId.value === '' || appSecret === undefined || appSecret.value === '') {
        credentialsCtx.logger.info('webhook-feishu: waiting for App ID and App Secret; configure them in Settings > Connections and restart DSH')
        return async () => {}
      }
      credentialsCtx.logger.info('webhook-feishu: connecting to Feishu over WebSocket')
      const channel: LarkChannel = createLarkChannel({
        appId: appId.value,
        appSecret: appSecret.value,
        transport: 'websocket',
        includeRawEvent: false,
        policy: {
          requireMention: active.requireMention,
          dmMode: active.allowedOpenIds.length === 0 ? 'open' : 'allowlist',
          ...(active.allowedOpenIds.length === 0 ? {} : { dmAllowlist: active.allowedOpenIds }),
        },
        safety: { dedup: { maxEntries: 2048 }, chatQueue: { enabled: true } },
        outbound: { textChunkLimit: 4000 },
        source: 'dsh-webhook-feishu',
        logger: {
          debug: (...args) => credentialsCtx.logger.debug(`webhook-feishu: ${args.map(String).join(' ')}`),
          info: (...args) => credentialsCtx.logger.info(`webhook-feishu: ${args.map(String).join(' ')}`),
          warn: (...args) => credentialsCtx.logger.warn(`webhook-feishu: ${args.map(String).join(' ')}`),
          error: (...args) => credentialsCtx.logger.error(`webhook-feishu: ${args.map(String).join(' ')}`),
          trace: (...args) => credentialsCtx.logger.debug(`webhook-feishu: ${args.map(String).join(' ')}`),
        },
      })
      channel.on('error', error => credentialsCtx.logger.error(`webhook-feishu: channel error (${error.code}): ${error.message}`))
      channel.on('reject', event => credentialsCtx.logger.warn(`webhook-feishu: message rejected (${event.reason})`))
      channel.on('reconnecting', () => credentialsCtx.logger.warn('webhook-feishu: WebSocket reconnecting'))
      channel.on('reconnected', () => credentialsCtx.logger.info('webhook-feishu: WebSocket reconnected'))
      sendReply = async (binding, text) => { await channel.send(binding.receiveId, { markdown: text }) }
      const stopMessages = channel.on('message', async (message) => {
        credentialsCtx.logger.info(`webhook-feishu: message received (type=${message.rawContentType}, chat=${message.chatType})`)
        if (message.rawContentType !== 'text' || message.content.trim() === '') return
        if (active.allowedOpenIds.length > 0 && !active.allowedOpenIds.includes(message.senderId)) return
        const parsed: FeishuMessageEvent = {
          eventId: message.messageId,
          ...(message.senderId === '' ? {} : { openId: message.senderId }),
          chatId: message.chatId,
          chatType: message.chatType,
          messageId: message.messageId,
          messageType: message.rawContentType,
          text: message.content.trim(),
          raw: null as never,
        }
        try {
          await dispatchMessage(parsed)
        } catch (error: unknown) {
          const detail = error instanceof Error ? error.message : String(error)
          credentialsCtx.logger.error(`webhook-feishu: message dispatch failed (event=${parsed.eventId}): ${detail}`)
          const receiveId = parsed.chatType === 'p2p' ? (parsed.openId ?? parsed.chatId) : (parsed.chatId ?? parsed.openId)
          if (receiveId !== undefined) {
            const receiveIdType = parsed.chatType === 'p2p' && parsed.openId !== undefined ? 'open_id' : 'chat_id'
            void client.sendMarkdownChunks({ receiveId, receiveIdType, text: `DSH 处理飞书消息失败：${detail}` }).catch((sendError) => {
              credentialsCtx.logger.warn(`webhook-feishu: dispatch error reply failed: ${String(sendError)}`)
            })
          }
        }
      })
      await channel.connect()
      credentialsCtx.logger.info('webhook-feishu: WebSocket connected and listening')
      return async () => {
        stopMessages()
        sendReply = async (binding, text) => {
          await client.sendMarkdownChunks({ receiveId: binding.receiveId, receiveIdType: binding.receiveIdType, text })
        }
        await channel.disconnect()
      }
    }, 'webhook-feishu: websocket channel'))
  }
}
