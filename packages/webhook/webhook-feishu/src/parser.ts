/** Parse and authenticate Feishu v2 callback envelopes. */

import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { FeishuMessageEvent } from './types.ts'
import { FeishuHttpError } from './body.ts'

type FeishuPayload = Record<string, unknown>

export function parseFeishuEnvelope(body: string): FeishuPayload {
  let value: unknown
  try { value = JSON.parse(body) } catch { throw new FeishuHttpError(400, 'request body is not valid JSON') }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new FeishuHttpError(400, 'Feishu payload must be an object')
  const snapshot = snapshotJsonValue(value)
  if (snapshot === undefined) throw new FeishuHttpError(400, 'Feishu payload is not lossless JSON')
  return snapshot as FeishuPayload
}

export function parseFeishuMessage(payload: FeishuPayload): FeishuMessageEvent | null {
  const header = payload.header
  const event = payload.event
  const message = isRecord(event) ? event.message : undefined
  if (!isRecord(header) || !isRecord(event) || !isRecord(message)) return null
  if (header.event_type !== 'im.message.receive_v1' || message.message_type !== 'text') return null
  const sender = isRecord(event.sender) && isRecord(event.sender.sender_id) ? event.sender.sender_id : {}
  let content: unknown
  try { content = JSON.parse(typeof message.content === 'string' ? message.content : '{}') } catch { return null }
  const text = isRecord(content) && typeof content.text === 'string' ? content.text.trim() : ''
  const openId = typeof sender.open_id === 'string' ? sender.open_id : undefined
  const chatId = typeof message.chat_id === 'string' ? message.chat_id : undefined
  if (text === '' || (openId === undefined && chatId === undefined)) return null
  return {
    eventId: typeof header.event_id === 'string' ? header.event_id : `${String(message.message_id ?? '')}:${String(message.create_time ?? '')}`,
    ...(typeof header.app_id === 'string' ? { appId: header.app_id } : {}),
    ...(openId === undefined ? {} : { openId }),
    ...(chatId === undefined ? {} : { chatId }),
    ...(typeof message.chat_type === 'string' ? { chatType: message.chat_type } : {}),
    ...(typeof message.message_id === 'string' ? { messageId: message.message_id } : {}),
    messageType: message.message_type,
    text,
    raw: payload as never,
  }
}

function isRecord(value: unknown): value is FeishuPayload {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
