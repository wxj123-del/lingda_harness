import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-session-map/client'
import type { SessionMapViewInjected } from '@deepseek-ai/dsh-client-ui-session-map/client'
import { SessionMapView } from '../src/client/SessionMapView.tsx'
import { apply as hostApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const fork = vi.fn(async () => 'child' as never)
  const open = vi.fn()
  ctx.provide('sessions', { fork, open } as never)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, fork, open, locale }
}

/** Declare the Conversation's view list so the registration has a home. */
function declareViews(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
  } as never, () => null)
}

describe('ui-session-map apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it drives', () => {
    expect(inject).toEqual(['slots', 'sessions', 'locale'])
  })

  it('registers the map tab once the view list is declared', async () => {
    const b = await bench()
    const frame = declareViews(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('conversation.view')[0]!
    expect(entry.component).toBe(SessionMapView)
    expect(entry.options).toMatchObject({ id: 'map', order: 15 })
    expect(entry.locale).toBe('sessionMap')
    // The tab label is a thunk so it follows the active locale.
    const label = entry.options.label as (() => string) | undefined
    expect(label?.()).toBe('地图')
    // The label follows the active locale through the bound translate.
    expect(b.locale.bind('sessionMap')('view.map')).toBe('地图')
    frame()
  })

  it('forks at the anchored turn and opens a listed branch', async () => {
    const b = await bench()
    const frame = declareViews(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (b.slots.entries('conversation.view')[0]!.inject as unknown as (
      sessionId: string,
    ) => SessionMapViewInjected)('session')
    await injected.forkAt(42)
    expect(b.fork).toHaveBeenCalledWith({ sessionId: 'session', atSeq: 42, increaseTitle: true })
    injected.openSession('child' as never)
    expect(b.open).toHaveBeenCalledWith('child')
    frame()
  })

  it('unregisters the tab on teardown', async () => {
    const b = await bench()
    const frame = declareViews(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
    frame()
  })
})
