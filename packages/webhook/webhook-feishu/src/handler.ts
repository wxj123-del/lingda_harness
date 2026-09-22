/** Feishu v2 callback authentication and message dispatch. */

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { readBoundedUtf8Body, FeishuHttpError } from './body.ts'
import { verifyFeishuSignature } from './feishu.ts'
import { parseFeishuEnvelope, parseFeishuMessage } from './parser.ts'

type FeishuPayload = Record<string, unknown>

export interface FeishuWebhookHandlerConfig {
  readonly verificationToken: CredentialRef
  readonly encryptKey?: CredentialRef
  readonly maxBodyBytes: number
  readonly requireMention: boolean
  readonly allowedOpenIds: readonly string[]
  readonly onMessage: (message: ReturnType<typeof parseFeishuMessage>, payload: FeishuPayload) => void | Promise<void>
}

function respond(response: import('node:http').ServerResponse, status: number, value?: unknown): void {
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.writeHead(status)
  response.end(value === undefined ? '' : JSON.stringify(value))
}

function isUrlVerification(payload: FeishuPayload): boolean {
  return payload.type === 'url_verification' && typeof payload.challenge === 'string'
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false
  const parts = value.split(';').map(part => part.trim())
  const [mediaType, parameter, ...extra] = parts
  if (mediaType?.toLowerCase() !== 'application/json') return false
  if (parameter === undefined) return true
  return extra.length === 0 && /^charset=(?:utf-8|"utf-8")$/iu.test(parameter)
}

function mentionedBot(payload: FeishuPayload): boolean {
  const event = payload.event
  const message = isRecord(event) ? event.message : undefined
  const mentions = isRecord(message) ? message.mentions : undefined
  return Array.isArray(mentions) && mentions.length > 0
}

function isRecord(value: unknown): value is FeishuPayload {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Build one exact Feishu callback route. */
export function createFeishuWebhookHandler(
  ctx: Context,
  config: FeishuWebhookHandlerConfig,
): WebRoute['handler'] {
  return async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST')
        throw new FeishuHttpError(405, 'method not allowed')
      }
      if (!isJsonContentType(request.headers['content-type'])) {
        throw new FeishuHttpError(415, 'content type must be application/json')
      }
      const body = await readBoundedUtf8Body(request, config.maxBodyBytes)
      const verification = await ctx.credentials.resolve(config.verificationToken)
      if (verification === undefined || verification.value === '') throw new FeishuHttpError(503, 'Feishu verification token is unavailable')
      const payload = parseFeishuEnvelope(body)
      if (isUrlVerification(payload)) {
        if (payload.token !== verification.value) throw new FeishuHttpError(401, 'invalid Feishu verification token')
        respond(response, 200, { challenge: payload.challenge })
        return
      }
      if (typeof payload.encrypt === 'string') {
        if (config.encryptKey === undefined) throw new FeishuHttpError(400, 'encrypted Feishu callbacks are not supported')
        const encrypted = await ctx.credentials.resolve(config.encryptKey)
        if (encrypted === undefined || encrypted.value === '') throw new FeishuHttpError(503, 'Feishu encrypt key is unavailable')
        const header = (name: string): string | undefined => {
          const value = request.headers[name]
          return Array.isArray(value) ? value[0] : value
        }
        if (!verifyFeishuSignature(body, header('x-lark-request-timestamp'), header('x-lark-request-nonce'), header('x-lark-signature'), encrypted.value)) {
          throw new FeishuHttpError(401, 'invalid Feishu event signature')
        }
        throw new FeishuHttpError(400, 'encrypted Feishu callbacks are not supported yet')
      }
      const header = payload.header
      const headerToken = isRecord(header) ? header.token : undefined
      if (headerToken !== verification.value) throw new FeishuHttpError(401, 'invalid Feishu event token')
      if (config.encryptKey !== undefined) {
        const encrypted = await ctx.credentials.resolve(config.encryptKey)
        if (encrypted === undefined || encrypted.value === '') throw new FeishuHttpError(503, 'Feishu encrypt key is unavailable')
        const header = (name: string): string | undefined => {
          const value = request.headers[name]
          return Array.isArray(value) ? value[0] : value
        }
        if (!verifyFeishuSignature(body, header('x-lark-request-timestamp'), header('x-lark-request-nonce'), header('x-lark-signature'), encrypted.value)) {
          throw new FeishuHttpError(401, 'invalid Feishu event signature')
        }
      }
      const message = parseFeishuMessage(payload)
      if (message !== null) {
        if (config.allowedOpenIds.length > 0 && (message.openId === undefined || !config.allowedOpenIds.includes(message.openId))) {
          respond(response, 403, { code: 'forbidden' })
          return
        }
        if (config.requireMention && message.chatType === 'group' && !mentionedBot(payload)) {
          respond(response, 202)
          return
        }
        void Promise.resolve(config.onMessage(message, payload)).catch((error: unknown) => {
          ctx.logger.warn(`webhook-feishu: message dispatch failed: ${String(error)}`)
        })
      }
      respond(response, 202)
    } catch (error: unknown) {
      if (error instanceof FeishuHttpError) {
        respond(response, error.status, { code: 'feishu_callback_error', message: error.message })
        return
      }
      ctx.logger.warn(`webhook-feishu: callback failed: ${String(error)}`)
      respond(response, 503, { code: 'feishu_callback_unavailable' })
    }
  }
}
