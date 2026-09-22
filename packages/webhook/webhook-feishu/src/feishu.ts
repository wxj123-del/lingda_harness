/** Small, dependency-free Feishu REST client used by the bot adapter. */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { FeishuTextMessage } from './types.ts'

const API_ROOT = 'https://open.feishu.cn/open-apis'

interface TokenState { token: string; expiresAt: number }

export interface FeishuClientConfig {
  readonly appId: CredentialRef
  readonly appSecret: CredentialRef
  readonly verificationToken?: CredentialRef
  readonly encryptKey?: CredentialRef
}

export function verifyFeishuSignature(
  body: string,
  timestamp: string | undefined,
  nonce: string | undefined,
  signature: string | undefined,
  encryptKey: string,
): boolean {
  if (timestamp === undefined || nonce === undefined || signature === undefined) return false
  const expected = createHash('sha256').update(timestamp + nonce + encryptKey + body).digest('hex')
  const actual = Buffer.from(signature)
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

export function decryptFeishuPayload(_payload: string, _encryptKey: string): never {
  throw new Error('encrypted Feishu callbacks are not supported yet; leave Encrypt Key empty or use the long-connection adapter')
}

export class FeishuClient {
  private tokenState: TokenState | undefined
  constructor(private readonly ctx: Context, private readonly config: FeishuClientConfig) {}

  private async credential(ref: CredentialRef, name: string): Promise<string> {
    const value = await this.ctx.credentials.resolve(ref)
    if (value === undefined || value.value === '') throw new Error(`Feishu ${name} credential is unavailable`)
    return value.value
  }

  private async tenantToken(): Promise<string> {
    if (this.tokenState !== undefined && this.tokenState.expiresAt > Date.now() + 30_000) return this.tokenState.token
    const appId = await this.credential(this.config.appId, 'app id')
    const appSecret = await this.credential(this.config.appSecret, 'app secret')
    const response = await fetch(`${API_ROOT}/auth/v3/tenant_access_token/internal`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    })
    const value: unknown = await response.json()
    if (!response.ok || !isRecord(value) || typeof value.tenant_access_token !== 'string') {
      throw new Error(`Feishu token request failed with HTTP ${String(response.status)}`)
    }
    const expires = typeof value.expire === 'number' && Number.isFinite(value.expire) ? value.expire : 7200
    this.tokenState = { token: value.tenant_access_token, expiresAt: Date.now() + expires * 1000 }
    return value.tenant_access_token
  }

  async sendText(message: FeishuTextMessage): Promise<void> {
    const token = await this.tenantToken()
    const response = await fetch(`${API_ROOT}/im/v1/messages?receive_id_type=${message.receiveIdType}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        receive_id: message.receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text: message.text }),
      }),
    })
    if (!response.ok) throw new Error(`Feishu message send failed with HTTP ${String(response.status)}`)
  }

  /** Send one Feishu post whose markdown element renders rich assistant output. */
  async sendMarkdown(message: FeishuTextMessage): Promise<void> {
    const token = await this.tenantToken()
    const response = await fetch(`${API_ROOT}/im/v1/messages?receive_id_type=${message.receiveIdType}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        receive_id: message.receiveId,
        msg_type: 'post',
        content: JSON.stringify({
          zh_cn: {
            title: '',
            content: [[{ tag: 'md', text: message.text }]],
          },
        }),
      }),
    })
    if (!response.ok) throw new Error(`Feishu message send failed with HTTP ${String(response.status)}`)
  }

  async sendMarkdownChunks(message: FeishuTextMessage, maxChars = 4000): Promise<void> {
    for (const text of splitMarkdown(message.text, maxChars)) {
      await this.sendMarkdown({ ...message, text })
    }
  }

  async sendTextChunks(message: FeishuTextMessage, maxChars = 4000): Promise<void> {
    for (let offset = 0; offset < message.text.length; offset += maxChars) {
      await this.sendText({ ...message, text: message.text.slice(offset, offset + maxChars) })
    }
  }
}

/** Prefer line boundaries so a rich-text chunk does not cut every paragraph in half. */
function splitMarkdown(text: string, maxChars: number): string[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) throw new RangeError('maxChars must be a positive safe integer')
  if (text.length === 0) return ['']
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf('\n', maxChars)
    if (cut <= 0) cut = maxChars
    chunks.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut)
    if (remaining.startsWith('\n')) remaining = remaining.slice(1)
  }
  chunks.push(remaining)
  return chunks
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
