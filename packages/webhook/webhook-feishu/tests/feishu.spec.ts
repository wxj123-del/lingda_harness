import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeishuClient, verifyFeishuSignature } from '../src/feishu.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('Feishu signature', () => {
  it('verifies the documented sha256 callback signature', () => {
    const body = '{"encrypt":"payload"}'
    const timestamp = '1700000000'
    const nonce = 'nonce'
    const key = 'encrypt-key'
    const signature = createHash('sha256').update(timestamp + nonce + key + body).digest('hex')
    expect(verifyFeishuSignature(body, timestamp, nonce, signature, key)).toBe(true)
    expect(verifyFeishuSignature(body, timestamp, nonce, signature.slice(1), key)).toBe(false)
  })
})

describe('Feishu outbound markdown', () => {
  it('sends assistant markdown as a rendered post message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tenant_access_token: 'tenant-token', expire: 7200 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = {
      credentials: { resolve: async () => ({ value: 'credential', source: 'test' }) },
    } as unknown as Context
    const client = new FeishuClient(ctx, {
      appId: credentialRef('DSH_FEISHU_APP_ID'),
      appSecret: credentialRef('DSH_FEISHU_APP_SECRET'),
    })

    await client.sendMarkdownChunks({ receiveId: 'oc_chat', receiveIdType: 'chat_id', text: '# 标题\n\n**重点**' })

    const request = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined
    expect(request?.method).toBe('POST')
    const body = typeof request?.body === 'string' ? request.body : ''
    expect(JSON.parse(body)).toEqual({
      receive_id: 'oc_chat',
      msg_type: 'post',
      content: JSON.stringify({
        zh_cn: { title: '', content: [[{ tag: 'md', text: '# 标题\n\n**重点**' }]] },
      }),
    })
  })
})
