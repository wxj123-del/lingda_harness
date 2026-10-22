import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import {
  credentialRef,
  type CredentialProvider, type CredentialRecord, type CredentialRecordEntry, type CredentialRecordInfo,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialKey } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, httpsTunnel, type PhoneAccessInternals, type PhoneAccessView } from '../src/index.ts'

const TOKEN_REF = credentialRef('DSH_NGROK_AUTHTOKEN')

/** A credentials provider holding exactly the references a test stores. */
function credentials(stored: Record<string, string>): CredentialProvider {
  const values = new Map(Object.entries(stored))
  const provider = {
    async resolve(ref: Parameters<CredentialProvider['resolve']>[0]): Promise<ResolvedCredential | undefined> {
      const value = values.get(String(ref))
      return value === undefined ? undefined : { value, source: 'file' }
    },
    async describe(): Promise<CredentialInfo> {
      return { configured: false, writable: true }
    },
    async set(): Promise<void> {},
    async unset(): Promise<void> {},
    async readRecord(): Promise<CredentialRecord | undefined> { return undefined },
    async describeRecord(): Promise<CredentialRecordInfo> {
      return { configured: false, writable: true }
    },
    async listRecords(): Promise<readonly CredentialRecordEntry[]> { return [] },
    async modifyRecord(): Promise<CredentialRecord | undefined> { return undefined },
    async deleteRecord(_key: CredentialKey): Promise<void> {},
  }
  return provider as unknown as CredentialProvider
}

/** One scripted ngrok child: its fields are writable where the real ones are not. */
interface FakeChild {
  pid: number | undefined
  exitCode: number | null
  kill: ReturnType<typeof vi.fn>
  once: ChildProcess['once']
  emit: (event: 'exit', code: number) => boolean
}

/** One fake ngrok process whose inspector answers are scripted. */
function tunnel(answers: readonly (string | undefined)[]) {
  const emitter = new EventEmitter()
  const child: FakeChild = {
    pid: 4242,
    exitCode: null,
    kill: vi.fn(() => {
      child.exitCode = 0
      child.emit('exit', 0)
      return true
    }),
    once: emitter.once.bind(emitter) as ChildProcess['once'],
    emit: emitter.emit.bind(emitter),
  }
  let read = 0
  const fetch = vi.fn(() => {
    const url = answers[Math.min(read, answers.length - 1)]
    read += 1
    return Promise.resolve(new Response(JSON.stringify({
      tunnels: url === undefined ? [] : [{ proto: 'https', public_url: url }],
    })))
  })
  return { child, fetch }
}

interface Bench {
  readonly ctx: Context
  readonly spawned: ReturnType<typeof vi.fn>
  readonly killed: ReturnType<typeof vi.fn>
}

async function bench(
  stored: Record<string, string>,
  answers: readonly (string | undefined)[],
  internals: PhoneAccessInternals = {},
): Promise<Bench> {
  const scripted = tunnel(answers)
  const spawned = vi.fn(() => scripted.child as unknown as ChildProcess)
  const { Context: Root } = await import('@deepseek-ai/cordis')
  const ctx = new Root()
  ctx.provide('webServer', { port: 3081 } as never)
  ctx.provide('connection', {
    authenticatedUrl: (base: string) => `${base.replace(/\/$/u, '')}/?token=launch-token`,
  } as never)
  ctx.provide('credentials', credentials(stored))
  const harness: { inject: string[]; apply: (pluginCtx: Context, config?: object) => void } = {
    inject: ['webServer', 'connection', 'credentials'],
    apply: (pluginCtx, config) => {
      apply(pluginCtx, config as never, {
        spawn: spawned as unknown as PhoneAccessInternals['spawn'],
        fetch: scripted.fetch,
        sleep: () => Promise.resolve(),
        timeoutMs: 1_000,
        ...internals,
      })
    },
  }
  await ctx.plugin(harness).await()
  return { ctx, spawned, killed: scripted.child.kill }
}

function service(ctx: Context) {
  return ctx.get('phoneAccess') as { generate(): Promise<PhoneAccessView>; current(): PhoneAccessView; stopTunnel(): Promise<void> }
}

describe('phone access', () => {
  afterEach(() => { vi.useRealTimers() })

  it('reads only the https tunnel out of an inspector body', () => {
    expect(httpsTunnel({ tunnels: [{ proto: 'http', public_url: 'http://x' }, { proto: 'https', public_url: 'https://x.ngrok.io' }] })).toBe('https://x.ngrok.io/')
    expect(httpsTunnel({ tunnels: [{ proto: 'http', public_url: 'http://x' }] })).toBeUndefined()
    expect(httpsTunnel({ tunnels: [{ proto: 'https', public_url: 'https://evil.example/?token=leak' }] })).toBeUndefined()
    expect(httpsTunnel({ tunnels: [{ proto: 'https', public_url: 'https://evil.ngrok-free.app/path' }] })).toBeUndefined()
    expect(httpsTunnel({ tunnels: [{ proto: 'https', public_url: 'https://user:pass@evil.ngrok-free.app' }] })).toBeUndefined()
    expect(httpsTunnel({ tunnels: [{ proto: 'https', public_url: 'https://evil.ngrok-free.app:444' }] })).toBeUndefined()
    expect(httpsTunnel({ tunnels: [{ proto: 'https', public_url: 'https://evil.ngrok-free.app.attacker.test' }] })).toBeUndefined()
    expect(httpsTunnel({})).toBeUndefined()
    expect(httpsTunnel(null)).toBeUndefined()
  })

  it('reports a missing authtoken without launching anything', async () => {
    const { ctx, spawned } = await bench({}, [])
    expect(await service(ctx).generate()).toEqual({ error: '还没有配置 ngrok authtoken。' })
    expect(spawned).not.toHaveBeenCalled()
  })

  it('opens one tunnel and returns the scan URL and restart command', async () => {
    const { ctx, spawned } = await bench({ [String(TOKEN_REF)]: 'secret-token' }, ['https://abc.ngrok-free.app'])
    const view = await service(ctx).generate()

    expect(view).toEqual({
      publicUrl: 'https://abc.ngrok-free.app/',
      host: 'abc.ngrok-free.app',
      scanUrl: 'https://abc.ngrok-free.app/?token=launch-token',
      restartCommand: 'dsh web --trusted-host abc.ngrok-free.app',
    })
    expect(service(ctx).current()).toEqual(view)
    const env = spawned.mock.calls[0]?.[2]?.env as Record<string, string>
    expect(env.NGROK_AUTHTOKEN).toBe('secret-token')
    expect(spawned.mock.calls[0]?.[1]).toEqual(['http', '3081', '--log=stdout'])
  })

  it('waits out an inspector that is not up yet', async () => {
    const { ctx } = await bench({ [String(TOKEN_REF)]: 'secret-token' }, [undefined, 'https://later.ngrok-free.app'])
    const view = await service(ctx).generate()
    expect(view.host).toBe('later.ngrok-free.app')
  })

  it('stops the previous tunnel before opening another', async () => {
    const { ctx, killed } = await bench({ [String(TOKEN_REF)]: 'secret-token' }, ['https://first.ngrok-free.app'])
    await service(ctx).generate()
    await service(ctx).generate()
    expect(killed).toHaveBeenCalledTimes(1)
    expect(service(ctx).current().host).toBe('first.ngrok-free.app')
  })

  it('reports a tunnel that exits before publishing an address', async () => {
    const dead: FakeChild = {
      pid: undefined,
      exitCode: 1,
      kill: vi.fn(() => true),
      once: (() => undefined) as unknown as ChildProcess['once'],
      emit: () => false,
    }
    const { ctx } = await bench({ [String(TOKEN_REF)]: 'secret-token' }, [], {
      spawn: (() => dead) as unknown as PhoneAccessInternals['spawn'],
    })
    const view = await service(ctx).generate()
    expect(view.scanUrl).toBeUndefined()
    expect(view.error).toContain('ngrok')
    expect(service(ctx).current()).toEqual({})
  })

  it('closes the tunnel when the fiber is disposed', async () => {
    const { ctx, killed } = await bench({ [String(TOKEN_REF)]: 'secret-token' }, ['https://abc.ngrok-free.app'])
    await service(ctx).generate()
    await ctx.fiber.dispose()
    expect(killed).toHaveBeenCalledTimes(1)
  })
})
