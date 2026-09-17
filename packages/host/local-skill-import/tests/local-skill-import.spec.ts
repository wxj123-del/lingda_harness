import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync } from 'fflate'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import LocalSkillImportGateway from '../src/index.ts'

const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temp(name: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `${name}-`))
  directories.push(path)
  return path
}

async function skill(root: string, path: string, name: string, extra = false): Promise<void> {
  const directory = join(root, path)
  await mkdir(join(directory, 'references'), { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} description\n---\nUse ${name}.`)
  if (extra) await writeFile(join(directory, 'references', 'notes.md'), 'notes')
}

async function harness(codexDirectory: string, agentsDirectory: string): Promise<LocalSkillImportGateway> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalSkillImportGateway, { codexDirectory, agentsDirectory, maxScanDepth: 16 })
  return ctx.get('localSkillImport') as LocalSkillImportGateway
}

describe('LocalSkillImportGateway', () => {
  it('publishes bounded list and archive methods', async () => {
    const codex = await temp('local-skills-codex')
    const agents = await temp('local-skills-agents')
    const gateway = await harness(codex, agents)
    expect(remoteMethods(gateway)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'archive', invocation: { kind: 'direct' } },
    ])
  })

  it('finds nested skills in both roots and returns a compatible archive', async () => {
    const codex = await temp('local-skills-codex')
    const agents = await temp('local-skills-agents')
    await skill(codex, 'one', 'codex-one', true)
    await skill(agents, 'bundle/skills/two', 'agents-two')
    const gateway = await harness(codex, agents)
    const scan = await gateway.list()
    expect(scan.candidates.map(item => ({ name: item.name, source: item.source, issue: item.issue }))).toEqual([
      { name: 'agents-two', source: 'agents', issue: null },
      { name: 'codex-one', source: 'codex', issue: null },
    ])
    const selected = scan.candidates.find(item => item.name === 'codex-one')!
    const result = await gateway.archive(selected.id)
    expect(Object.keys(unzipSync(Uint8Array.from(Buffer.from(result.archive, 'base64')))).sort()).toEqual([
      'SKILL.md',
      'references/notes.md',
    ])
  })

  it('does not follow symbolic links and marks oversized skills as unavailable', async () => {
    const codex = await temp('local-skills-codex')
    const agents = await temp('local-skills-agents')
    const outside = await temp('local-skills-outside')
    await skill(outside, 'linked', 'linked-skill')
    await symlink(join(outside, 'linked'), join(codex, 'linked'))
    await skill(codex, 'large', 'large-skill')
    await writeFile(join(codex, 'large', 'large.bin'), new Uint8Array(8 * 1024 * 1024 + 1))
    const gateway = await harness(codex, agents)
    const scan = await gateway.list()
    expect(scan.candidates.some(item => item.name === 'linked-skill')).toBe(false)
    expect(scan.candidates.find(item => item.name === 'large-skill')?.issue).toBe('tooLarge')
  })

  it('rejects a candidate that changed after scanning', async () => {
    const codex = await temp('local-skills-codex')
    const agents = await temp('local-skills-agents')
    await skill(codex, 'mutable', 'mutable-skill')
    const gateway = await harness(codex, agents)
    const [candidate] = (await gateway.list()).candidates
    await writeFile(join(codex, 'mutable', 'SKILL.md'), 'invalid')
    await expect(gateway.archive(candidate!.id)).rejects.toThrow('invalidMetadata')
  })
})
