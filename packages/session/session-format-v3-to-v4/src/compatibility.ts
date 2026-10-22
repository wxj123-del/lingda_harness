/** Private V4-to-V3 validation view for the message sources added after V3. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatJsonObject, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'

/**
 * Replace only the V4 Feishu source variant in a detached validation view.
 * The returned event is never exposed; the original V4 event remains intact.
 */
export function v3CompatibleEvent(event: SessionFormatEvent): SessionFormatEvent {
  const data = event.data
  let nextData: SessionFormatJsonValue = data
  switch (event.type) {
    case 'user/message':
      nextData = v3CompatibleMessage(data, `${event.type} source`)
      break
    case 'system/message':
    case 'assistant/message':
    case 'tool/result':
    case 'team/message/queued': {
      if (!isSessionFormatJsonObject(data)) break
      const message = data['message']
      if (message === undefined) break
      const nextMessage = v3CompatibleMessage(message, `${event.type} message source`)
      if (nextMessage !== message) nextData = { ...data, message: nextMessage }
      break
    }
    case 'agent/inbox/spliced':
    case 'session/title-llm-request': {
      if (!isSessionFormatJsonObject(data)) break
      const key = event.type === 'agent/inbox/spliced' ? 'inserted' : 'messages'
      const messages = data[key]
      if (!Array.isArray(messages)) break
      const nextMessages = messages.map((message, index) => v3CompatibleMessage(message, `${event.type} ${key}[${index}] source`))
      if (nextMessages.some((message, index) => message !== messages[index])) nextData = { ...data, [key]: nextMessages }
      break
    }
  }
  return nextData === data ? event : { ...event, data: nextData }
}

function v3CompatibleMessage(value: SessionFormatJsonValue, label: string): SessionFormatJsonValue {
  if (!isSessionFormatJsonObject(value)) return value
  const source = value['source']
  if (!isSessionFormatJsonObject(source) || source['kind'] !== 'feishu') return value
  assertFeishuSource(source, label)
  return {
    ...value,
    source: {
      kind: 'plugin',
      plugin: 'dsh-webhook-feishu',
      form: 'notice',
      summary: source['summary'] as string,
    },
  }
}

function assertFeishuSource(source: SessionFormatJsonObject, label: string): void {
  const expected = ['kind', 'source', 'eventId', 'form', 'summary']
  const unexpected = Object.keys(source).find(key => !expected.includes(key))
  const missing = expected.find(key => !Object.hasOwn(source, key))
  if (missing !== undefined || unexpected !== undefined) {
    throw new SessionFormatError(`${label} Feishu source must contain exactly kind, source, eventId, form, and summary`)
  }
  if (source['form'] !== 'notice') throw new SessionFormatError(`${label} Feishu source form must be notice`)
  for (const key of ['source', 'eventId', 'summary'] as const) {
    if (typeof source[key] !== 'string' || source[key].length === 0) {
      throw new SessionFormatError(`${label} Feishu source ${key} must be a non-empty string`)
    }
  }
}
