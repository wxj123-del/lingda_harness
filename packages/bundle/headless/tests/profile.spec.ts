/** The Headless bundle's declared profile patch. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

interface PatchRow {
  id?: string
  config?: Record<string, unknown>
}

describe('dsh-headless bundle profile', () => {
  it('starts fresh Sessions in execution mode without changing the shared step limits', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const patches = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    ) as PatchRow[]
    const basePatches = yaml.load(
      readFileSync(resolve(root, '../base/cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: PatchRow[] }>
    const baseConfig = basePatches.flatMap(patch => patch.insert ?? [])
      .find(row => row.id === 'personal-agent')?.config

    expect(baseConfig).toBeDefined()
    expect(patches.find(patch => patch.id === 'personal-agent')?.config).toEqual({
      ...baseConfig,
      defaultMode: 'execution',
    })
  })
})
