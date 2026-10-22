import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sourceArtifactViolations } from './verify-source-artifacts.ts'

const roots: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-source-artifacts-'))
  roots.push(root)
  mkdirSync(join(root, 'packages/core/example/src'), { recursive: true })
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('source artifact gate', () => {
  it('allows TypeScript sources and ambient declarations', () => {
    const root = fixture()
    writeFileSync(join(root, 'packages/core/example/src/index.ts'), 'export const value = 1\n')
    writeFileSync(join(root, 'packages/core/example/src/css-modules.d.ts'), 'declare module "*.css"\n')

    expect(sourceArtifactViolations(root)).toEqual([])
  })

  it('rejects emitted JavaScript, maps, and a declaration beside its source', () => {
    const root = fixture()
    const source = join(root, 'packages/core/example/src/index')
    writeFileSync(`${source}.ts`, 'export const value = 1\n')
    writeFileSync(`${source}.js`, 'export const value = 1;\n')
    writeFileSync(`${source}.js.map`, '{}\n')
    writeFileSync(`${source}.d.ts`, 'export declare const value = 1;\n')
    writeFileSync(`${source}.d.ts.map`, '{}\n')

    expect(sourceArtifactViolations(root)).toEqual([
      'packages/core/example/src/index.d.ts.map: generated artifact must be emitted below lib/, not src/',
      'packages/core/example/src/index.d.ts: generated declaration shadows an adjacent TypeScript source file',
      'packages/core/example/src/index.js.map: generated artifact must be emitted below lib/, not src/',
      'packages/core/example/src/index.js: generated artifact must be emitted below lib/, not src/',
    ])
  })
})
