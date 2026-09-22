/** Feishu event payloads exposed to adapter tests and downstream rules. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export interface FeishuMessageEvent {
  readonly eventId: string
  readonly appId?: string
  readonly openId?: string
  readonly chatId?: string
  readonly chatType?: string
  readonly messageId?: string
  readonly messageType: string
  readonly text: string
  readonly raw: JsonValue
}

export interface FeishuTextMessage {
  readonly text: string
  readonly receiveId: string
  readonly receiveIdType: 'chat_id' | 'open_id'
}
