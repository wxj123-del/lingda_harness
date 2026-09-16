import { describe, expect, it } from 'vitest'
import { lingdaClosure, type LingdaMember } from './lingda.ts'

function member(name: string, options: Partial<LingdaMember['manifest']> = {}): LingdaMember {
  return { directory: name, manifest: { name, version: '1.0.0', ...options } }
}

describe('Lingda npm runtime selection', () => {
  it('includes customized packages and peers through cycles without pulling platform binaries', () => {
    const packages = [
      member('cli', { dependencies: { ui: 'workspace:^', external: '^2.0.0' } }),
      member('ui', { peerDependencies: { cli: 'workspace:^' }, optionalDependencies: { native: 'workspace:*' } }),
      member('native', { os: ['darwin'], cpu: ['arm64'] }),
      member('unused'),
    ]
    const selected = lingdaClosure(new Map(packages.map(entry => [entry.manifest.name, entry])), ['cli'])
    expect(selected.map(entry => entry.manifest.name)).toEqual(['cli', 'ui'])
  })

  it('rejects a missing local plugin instead of installing its upstream version', () => {
    const cli = member('cli', { dependencies: { custom: 'workspace:^' } })
    expect(() => lingdaClosure(new Map([['cli', cli]]), ['cli'])).toThrow('needs missing custom')
  })

  it('rejects a required platform binary in the portable runtime', () => {
    const cli = member('cli', { dependencies: { native: 'workspace:^' } })
    const native = member('native', { os: ['darwin'] })
    expect(() => lingdaClosure(new Map([['cli', cli], ['native', native]]), ['cli'])).toThrow('required platform package')
  })
})
