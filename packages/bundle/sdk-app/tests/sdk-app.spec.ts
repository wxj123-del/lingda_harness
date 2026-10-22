/** The SDK app bundle's declared profile patch. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-sdk-app bundle', () => {
  it('declares startup-gated JSON-RPC serving with the non-interactive execution policy', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-sdk-jsonrpc-server')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{
      id?: string
      disabled?: boolean
      config?: Record<string, unknown>
      insert?: Array<{ id?: string; inject?: string[]; name?: string }>
    }>
    const basePatches = yaml.load(
      readFileSync(resolve(root, '../base/cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; config?: Record<string, unknown> }> }>
    const baseConfig = basePatches.flatMap(patch => patch.insert ?? [])
      .find(row => row.id === 'personal-agent')?.config
    expect(patches.find(patch => patch.id === 'hmr')).toBeUndefined()
    expect(patches.find(patch => patch.id === 'session-title-llm')).toMatchObject({ disabled: true })
    expect(baseConfig).toBeDefined()
    expect(patches.find(patch => patch.id === 'personal-agent')?.config).toEqual({
      ...baseConfig,
      defaultMode: 'execution',
    })
    const rows = patches.flatMap(patch => patch.insert ?? [])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.name).toBe('@deepseek-ai/dsh-sdk-app')
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')?.inject).toEqual(['sdkAppStartup', 'loader'])
  })
})
