import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

function harness(): { ctx: Context; register: ReturnType<typeof vi.fn> } {
  const ctx = new Context()
  contexts.push(ctx)
  const register = vi.fn(() => vi.fn())
  ctx.provide('webServer', { register } as never)
  ctx.provide('credentials', {} as never)
  ctx.provide('agents', {} as never)
  ctx.provide('agentDefaultModel', {} as never)
  ctx.provide('agentPresets', {} as never)
  ctx.provide('permissionPresets', {} as never)
  ctx.provide('sessionTitle', {} as never)
  ctx.provide('workspaceRegistry', {} as never)
  return { ctx, register }
}

const valid: Config = {
  transport: 'webhook', path: '/feishu', appIdEnv: 'DSH_FEISHU_APP_ID', appSecretEnv: 'DSH_FEISHU_APP_SECRET', verificationTokenEnv: 'DSH_FEISHU_VERIFICATION_TOKEN',
  workspacePath: '/tmp/dsh-feishu',
  agentPreset: 'standard', permissionPreset: 'read-only', source: 'primary-feishu',
  maxBodyBytes: 1024, requireMention: true, allowedOpenIds: [],
}

describe('Feishu adapter config', () => {
  it('registers an exact callback route', () => {
    const test = harness()
    apply(test.ctx, valid)
    expect(test.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exact', path: '/feishu' }))
  })

  it('does not require an HTTP token for websocket transport', () => {
    const test = harness()
    const { verificationTokenEnv: _verificationTokenEnv, ...websocketConfig } = valid
    apply(test.ctx, { ...websocketConfig, transport: 'websocket' })
    expect(test.register).not.toHaveBeenCalled()
  })

  it.each([
    [{ ...valid, path: '/' }, /path/],
    [{ ...valid, path: 'feishu' }, /path/],
    [{ ...valid, appIdEnv: 'bad value' }, /credential ref/],
  ] as const)('rejects invalid config %#', (config, error) => {
    const test = harness()
    expect(() => apply(test.ctx, config)).toThrow(error)
    expect(test.register).not.toHaveBeenCalled()
  })
})
