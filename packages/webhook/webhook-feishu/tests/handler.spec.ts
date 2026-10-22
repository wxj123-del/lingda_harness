import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createFeishuWebhookHandler } from '../src/handler.ts'
import type { FeishuMessageEvent } from '../src/types.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() =>{  resolve() }))))
})

type MessageHandler = (message: FeishuMessageEvent | null, payload: Record<string, unknown>) => void

function fakeContext(token = 'verify-token'): { ctx: Context; onMessage: Mock<MessageHandler> } {
  const onMessage: Mock<MessageHandler> = vi.fn(() => {})
  return {
    ctx: {
      credentials: { resolve: async () => ({ value: token, source: 'test' }) },
      logger: { warn: vi.fn() },
    } as unknown as Context,
    onMessage,
  }
}

async function serve(ctx: Context, onMessage: Mock<MessageHandler>): Promise<string> {
  const handler = createFeishuWebhookHandler(ctx, {
    verificationToken: credentialRef('DSH_FEISHU_VERIFICATION_TOKEN'),
    maxBodyBytes: 4096,
    requireMention: true,
    allowedOpenIds: [],
    onMessage,
  })
  const server = createServer((request, response) => { void handler(request, response) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

async function post(base: string, body: unknown): Promise<Response> {
  return await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(typeof body === 'string' ? JSON.parse(body) : body),
  })
}

describe('Feishu HTTP callback handler', () => {
  it('answers URL verification and dispatches text messages asynchronously', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx, fake.onMessage)
    const challenge = await post(base, { type: 'url_verification', token: 'verify-token', challenge: 'challenge-1' })
    expect(challenge.status).toBe(200)
    expect(await challenge.json()).toEqual({ challenge: 'challenge-1' })

    const response = await post(base, {
      header: { token: 'verify-token', event_type: 'im.message.receive_v1', event_id: 'evt-1' },
      event: {
        sender: { sender_id: { open_id: 'ou_sender' } },
        message: {
          message_id: 'om-1', message_type: 'text', chat_type: 'p2p', chat_id: 'oc-chat',
          content: JSON.stringify({ text: 'hello from phone' }),
        },
      },
    })
    expect(response.status).toBe(202)
    await vi.waitFor(() =>{  expect(fake.onMessage).toHaveBeenCalledOnce() })
    expect(fake.onMessage.mock.calls[0]?.[0]).toMatchObject({ eventId: 'evt-1', openId: 'ou_sender', text: 'hello from phone' })
  })

  it('rejects an invalid verification token', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx, fake.onMessage)
    const response = await post(base, { type: 'url_verification', token: 'wrong', challenge: 'nope' })
    expect(response.status).toBe(401)
    expect(fake.onMessage).not.toHaveBeenCalled()
  })
})
