/** Browser parser and local resource integration for the combined layout package. */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { decodeSkillArchive, encodeSkillArchive, MAX_SKILL_ARCHIVE_BYTES, readSkillArchive } from '../src/skill-archive.ts'
import { materializeSkillArchive } from '../src/skill-archive-resources.ts'

const instructions = '---\nname: cover-assistant\ndescription: Create article covers\nmetadata:\n  category: writing\n---\nRead references/style.md before drafting.'
const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? strToU8(value) : value])))

describe('Skill archive validation', () => {
  it.each(['', 'download/cover/'])('recognizes a single Skill at %s and retains its resources', (root) => {
    const bytes = zip({ [`${root}SKILL.md`]: instructions, [`${root}references/style.md`]: 'Style notes', [`${root}assets/palette.bin`]: new Uint8Array([0, 255, 42]), '__MACOSX/._SKILL.md': 'ignored' })
    const skill = readSkillArchive(bytes)
    expect(skill).toMatchObject({ name: 'cover-assistant', description: 'Create article covers', category: 'writing', invocation: { modelInvocable: true, userInvocable: true } })
    expect(skill.body).toBe('Read references/style.md before drafting.')
    expect(Object.keys(skill.files).sort()).toEqual(['SKILL.md', 'assets/palette.bin', 'references/style.md'])
    expect(decodeSkillArchive(encodeSkillArchive(bytes))).toEqual(bytes)
  })

  it('retains explicit invocation restrictions and accepts CRLF frontmatter', () => {
    const content = instructions.replace('metadata:', 'disable-model-invocation: true\nuser-invocable: false\nmetadata:').replaceAll('\n', '\r\n')
    expect(readSkillArchive(zip({ 'SKILL.md': content })).invocation).toEqual({ modelInvocable: false, userInvocable: false })
  })

  it.each([
    [{ 'README.md': 'not a Skill' }, 'missingSkill'],
    [{ 'a/SKILL.md': instructions, 'b/SKILL.md': instructions }, 'multipleSkills'],
    [{ 'SKILL.md': 'plain markdown' }, 'invalidMetadata'],
    [{ 'SKILL.md': instructions.replace('name: cover-assistant', 'name: [bad') }, 'invalidMetadata'],
    [{ 'SKILL.md': instructions.replace('name: cover-assistant', 'name: Bad Name') }, 'invalidMetadata'],
    [{ 'SKILL.md': instructions.replace('description: Create article covers', 'description: ""') }, 'invalidMetadata'],
    [{ 'SKILL.md': instructions.replace('metadata:', 'user-invocable: maybe\nmetadata:') }, 'invalidMetadata'],
    [{ 'SKILL.md': instructions.replace('metadata:', 'modelInvocable: false\nmetadata:') }, 'invalidMetadata'],
    [{ 'SKILL.md': instructions.replace('Read references/style.md before drafting.', ' ') }, 'emptyBody'],
    [{ 'SKILL.md': instructions, '../outside.txt': 'bad' }, 'unsafePath'],
    [{ 'SKILL.md': instructions, '/outside.txt': 'bad' }, 'unsafePath'],
    [{ 'SKILL.md': instructions, 'a\\outside.txt': 'bad' }, 'unsafePath'],
    [{ 'SKILL.md': instructions, 'skill.md': instructions }, 'unsafePath'],
  ] satisfies [Record<string, string>, string][])('rejects invalid archive %# before import', (files, code) => {
    expect(() => readSkillArchive(zip(files))).toThrow(code)
  })

  it('rejects malformed ZIP and Base64 data', () => {
    expect(() => readSkillArchive(strToU8('not a zip'))).toThrow('invalidZip')
    expect(() => decodeSkillArchive('!not-base64!')).toThrow('invalidZip')
  })

  it('bounds compressed size, expanded size and entry count', () => {
    expect(() => readSkillArchive(new Uint8Array(MAX_SKILL_ARCHIVE_BYTES + 1))).toThrow('tooLarge')
    expect(() => decodeSkillArchive('a'.repeat(Math.ceil(MAX_SKILL_ARCHIVE_BYTES / 3) * 4 + 1))).toThrow('tooLarge')
    expect(() => readSkillArchive(zip({ 'SKILL.md': instructions, 'large.bin': new Uint8Array(8 * 1024 * 1024) }))).toThrow('tooLarge')
    const many = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`file-${index}`, '']))
    expect(() => readSkillArchive(zip({ 'SKILL.md': instructions, ...many }))).toThrow('tooLarge')
  })
})

describe('Imported Skill resources', () => {
  it('materializes exact attachments once across concurrent loads without executing scripts', async () => {
    const home = await mkdtemp(join(tmpdir(), 'skill-import-test-'))
    try {
      const archive = encodeSkillArchive(zip({ 'cover/SKILL.md': instructions, 'cover/references/style.md': 'Style notes', 'cover/assets/palette.bin': new Uint8Array([0, 255, 42]), 'cover/scripts/run.sh': 'exit 99' }))
      const directories = await Promise.all([materializeSkillArchive(archive, home), materializeSkillArchive(archive, home)])
      expect(directories[0]).toBe(directories[1])
      const directory = directories[0]!
      expect(await materializeSkillArchive(archive, home)).toBe(directory)
      expect(await readFile(join(directory, 'references/style.md'), 'utf8')).toBe('Style notes')
      expect(new Uint8Array(await readFile(join(directory, 'assets/palette.bin')))).toEqual(new Uint8Array([0, 255, 42]))
      expect(await readFile(join(directory, 'scripts/run.sh'), 'utf8')).toBe('exit 99')
      expect(await readdir(join(home, 'skill-imports'))).toHaveLength(1)
      await expect(materializeSkillArchive(encodeSkillArchive(zip({ 'SKILL.md': instructions, '../escaped': 'bad' })), home)).rejects.toThrow('unsafePath')
      expect(await readdir(home)).toEqual(['skill-imports'])
    } finally { await rm(home, { recursive: true, force: true }) }
  })
})
