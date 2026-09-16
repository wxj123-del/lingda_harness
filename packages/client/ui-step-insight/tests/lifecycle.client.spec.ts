// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { expect, it } from 'vitest'
import * as plugin from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

it('shadows the trajectory view and restores it after plugin disposal', async () => {
  const ctx = new Context()
  try {
    const slots = new SlotRegistry(ctx)
    ctx.provide('sessions', {} as never)
    ctx.provide('locale', { register: () => () => {}, bind: () => (key: keyof typeof zh) => zh[key] } as never)
    slots.register({ name: 'root', children: { 'conversation.view': { kind: 'list', scope: 'session' } } }, (_props: { renderSlot?: unknown }) => null)
    slots.register({ name: 'conversation.view', id: 'trajectory', label: 'Original' }, () => null)
    const fiber = ctx.plugin(plugin)
    await fiber.await()
    expect(slots.entries('conversation.view').find(entry => entry.options.id === 'trajectory')?.options.priority).toBe(-10)
    await fiber.dispose()
    expect(slots.entries('conversation.view').find(entry => entry.options.id === 'trajectory')?.options.label).toBe('Original')
  } finally {
    await ctx.fiber.dispose()
  }
})
