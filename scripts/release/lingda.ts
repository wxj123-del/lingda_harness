/** Package the local Lingda runtime as one npm package without publishing upstream package names. */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readClientBuildRecord } from '../client-build-environment.ts'
import { pnpmInvocation } from '../pnpm-invocation.ts'
import { capture, isEntry, runConcurrent } from './process.ts'

interface Manifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  os?: string[]
  cpu?: string[]
}

/** A local package whose published files supply the standalone runtime. */
export interface LingdaMember {
  directory: string
  manifest: Manifest
}

const ROOTS = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-image-generation',
  '@deepseek-ai/dsh-speech-generation',
  '@deepseek-ai/dsh-client-ui-step-insight',
]

/**
 * Resolve local runtime dependencies and peers, leaving platform binaries to npm.
 * @param available - Workspace packages indexed by name.
 * @param roots - Product entries whose runtime dependencies must be included.
 * @returns Every required local package exactly once, sorted by package name.
 */
export function lingdaClosure(available: ReadonlyMap<string, LingdaMember>, roots: readonly string[] = ROOTS): LingdaMember[] {
  const selected = new Map<string, LingdaMember>()
  const visit = (name: string): void => {
    if (selected.has(name)) return
    const member = available.get(name)
    if (member === undefined) throw new Error(`Lingda package: missing workspace package ${name}`)
    selected.set(name, member)
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      for (const [dependency, range] of Object.entries(member.manifest[section] ?? {})) {
        const target = available.get(dependency)
        if (target?.manifest.os !== undefined || target?.manifest.cpu !== undefined) {
          if (section !== 'optionalDependencies') throw new Error(`Lingda package: required platform package ${dependency}`)
          continue
        }
        if (target !== undefined) visit(dependency)
        else if (range.startsWith('workspace:')) throw new Error(`Lingda package: ${name} needs missing ${dependency}`)
      }
    }
  }
  roots.forEach(visit)
  return [...selected.values()].sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))
}

/** Pack built workspace payloads into a self-contained npm distribution directory. */
async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '../..')
  const { values } = parseArgs({ options: { build: { type: 'boolean' } }, allowPositionals: false })
  if (values.build === true) {
    const invocation = pnpmInvocation(['run', 'build'])
    await runConcurrent(invocation.command, invocation.args, {
      cwd: root,
      env: { ...process.env, DSH_CLIENT_TITLE: 'Lingda Harness' },
    })
  }
  const record = readClientBuildRecord(root)
  if (record.environment.DSH_CLIENT_TITLE !== 'Lingda Harness') {
    throw new Error('Lingda package needs branded client artifacts; run pnpm release:lingda')
  }
  for (const file of ['apps/cli/lib/bin.js', 'apps/web/dist/index.html']) {
    if (!existsSync(join(root, file))) throw new Error(`Missing ${file}; run pnpm build first`)
  }
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { workspaces: string[] }
  const available = new Map<string, LingdaMember>()
  for (const path of globSync(rootManifest.workspaces.map(pattern => `${pattern}/package.json`), { cwd: root })) {
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8')) as Manifest
    available.set(manifest.name, { directory: dirname(join(root, path)), manifest })
  }
  const members = lingdaClosure(available)
  const temporary = mkdtempSync(join(tmpdir(), 'lingda-npm-pack-'))
  const staging = join(temporary, 'package')
  const tarballs = join(staging, 'packages')
  const output = join(root, 'dist/lingda')
  try {
    cpSync(join(root, 'distribution/npm'), staging, { recursive: true })
    mkdirSync(tarballs)
    for (const file of ['README.md', 'README.zh.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      cpSync(join(root, file), join(staging, file))
    }
    const packages: { name: string; file: string; integrity: string }[] = []
    for (const [index, member] of members.entries()) {
      const invocation = pnpmInvocation(['--dir', member.directory, 'pack', '--pack-destination', tarballs])
      capture(invocation.command, invocation.args, { cwd: root })
      const filename = `${member.manifest.name.replace(/^@/u, '').replaceAll('/', '-')}-${member.manifest.version}.tgz`
      packages.push({
        name: member.manifest.name,
        file: filename,
        integrity: `sha512-${createHash('sha512').update(readFileSync(join(tarballs, filename))).digest('base64')}`,
      })
      console.log(`Lingda package: ${String(index + 1)}/${String(members.length)} ${member.manifest.name}`)
    }
    const manifest = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8')) as Record<string, unknown>
    delete manifest.scripts
    writeFileSync(join(staging, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(join(staging, 'runtime.json'), `${JSON.stringify({ packages }, null, 2)}\n`)
    mkdirSync(output, { recursive: true })
    const packed = JSON.parse(capture('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: staging })) as {
      filename: string
      size: number
      unpackedSize: number
    }[]
    console.log(JSON.stringify({
      output,
      packages: members.length,
      tarballs: packed.map(({ filename, size, unpackedSize }) => ({ filename, size, unpackedSize })),
    }))
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (isEntry(import.meta.url)) await main()
