import { describe, expect, it } from 'vitest'
import {
  applyTaskPatch,
  isVerifiedEvidence,
  normalizeCommand,
  observedCommand,
  observedFile,
  reverifiableCommands,
  unverifiedAcceptance,
} from '../src/state.ts'
import type { FileFact, ShellFact } from '../src/state.ts'
import type { TaskEvidence, TaskState } from '../src/types.ts'

const NOW = 1_700_000_000_000

const FACTS: ShellFact[] = [
  { name: 'shell', command: 'npm  test', exitCode: 0 },
  { name: 'shell', command: 'node cli.mjs search token', exitCode: 0 },
  { name: 'shell', command: 'npm run lint', exitCode: 2 },
]

function taskWith(evidence: Parameters<typeof applyTaskPatch>[1]['evidence']): TaskState {
  return applyTaskPatch(null, {
    objective: 'Verify evidence',
    acceptance: ['tests pass', 'cli works'],
    ...(evidence === undefined ? {} : { evidence }),
  }, NOW)
}

describe('evidence verification', () => {
  it('normalizes whitespace before comparing commands', () => {
    expect(normalizeCommand('  npm   test \n')).toBe('npm test')
    expect(normalizeCommand('npm\ttest')).toBe('npm test')
  })

  it('treats an automatic record as observed', () => {
    expect(isVerifiedEvidence({
      id: 'e1',
      kind: 'command',
      ref: 'anything',
      status: 'pass',
      acceptance: [1],
      at: NOW,
      auto: true,
    }, [])).toBe(true)
  })

  it('verifies a command record only when the log shows that command exiting zero', () => {
    const passing = taskWith([
      { kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] },
    ])
    expect(unverifiedAcceptance(passing, FACTS)).toEqual([2])
    expect(unverifiedAcceptance(passing, [])).toEqual([1, 2])
  })

  it('does not verify a command that failed in the log', () => {
    const record: TaskEvidence = {
      id: 'e1',
      kind: 'test',
      ref: 'npm run lint',
      status: 'pass',
      acceptance: [1],
      at: NOW,
    }
    expect(isVerifiedEvidence(record, FACTS)).toBe(false)
    expect(isVerifiedEvidence(record, [{ name: 'shell', command: 'npm run lint', exitCode: 2 }])).toBe(false)
  })

  it('does not verify a manual or file record from the log', () => {
    expect(isVerifiedEvidence({
      id: 'e1',
      kind: 'manual',
      ref: 'I checked it',
      status: 'pass',
      acceptance: [1],
      at: NOW,
    }, FACTS)).toBe(false)
  })

  it('ignores failing records when computing unverified coverage', () => {
    const task = taskWith([
      { kind: 'test', ref: 'npm test', status: 'fail', acceptance: [1] },
      { kind: 'test', ref: 'npm test', status: 'pass', acceptance: [2] },
    ])
    expect(unverifiedAcceptance(task, FACTS)).toEqual([1])
  })

  it('rejects completion on asserted-only evidence under the strict policy', () => {
    const asserted = taskWith([
      { kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] },
      { kind: 'command', ref: 'node cli.mjs search token', status: 'pass', acceptance: [2] },
    ])
    expect(() => applyTaskPatch(asserted, { status: 'succeeded' }, NOW, {
      requireVerifiedEvidence: true,
      shellFacts: [],
    })).toThrow(/have only asserted evidence/)
  })

  it('accepts completion once the log backs every criterion under the strict policy', () => {
    const asserted = taskWith([
      { kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] },
      { kind: 'command', ref: 'node cli.mjs search token', status: 'pass', acceptance: [2] },
    ])
    const done = applyTaskPatch(asserted, { status: 'succeeded' }, NOW, {
      requireVerifiedEvidence: true,
      shellFacts: FACTS,
    })
    expect(done.status).toBe('succeeded')
  })

  it('accepts an automatic record under the strict policy without log lookup', () => {
    const automatic = applyTaskPatch(taskWith(undefined), {
      evidence: [{ kind: 'command', ref: 'npm test', status: 'pass', acceptance: [1, 2] }],
    }, NOW + 1)
    // Mark both records automatic the way the shell observer would.
    const withAuto: TaskState = {
      ...automatic,
      evidence: automatic.evidence.map(record => ({ ...record, auto: true as const })),
    }
    const done = applyTaskPatch(withAuto, { status: 'succeeded' }, NOW + 2, {
      requireVerifiedEvidence: true,
      shellFacts: [],
    })
    expect(done.status).toBe('succeeded')
  })

  it('keeps the lenient policy when verification is not required', () => {
    const asserted = taskWith([
      { kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] },
      { kind: 'test', ref: 'made up', status: 'pass', acceptance: [2] },
    ])
    const done = applyTaskPatch(asserted, { status: 'succeeded' }, NOW, {
      requireVerifiedEvidence: false,
    })
    expect(done.status).toBe('succeeded')
  })
})

describe('tolerant command matching', () => {
  const FACTS: ShellFact[] = [
    { name: 'bash', command: 'node --test work.test.mjs', exitCode: 0 },
    { name: 'bash', command: 'node --test work.test.mjs; echo "EXIT=$?"', exitCode: 0 },
    { name: 'bash', command: 'npm run lint', exitCode: 2 },
  ]

  it('accepts a ref that appends a suffix to the observed command', () => {
    const record = {
      id: 'e1',
      kind: 'test' as const,
      ref: 'node --test work.test.mjs',
      status: 'pass' as const,
      acceptance: [1],
      at: NOW,
    }
    expect(isVerifiedEvidence(record, FACTS)).toBe(true)
  })

  it('accepts a ref the observed command contains', () => {
    const record = {
      id: 'e1',
      kind: 'test' as const,
      ref: 'node --test work.test.mjs',
      status: 'pass' as const,
      acceptance: [1],
      at: NOW,
    }
    const facts: ShellFact[] = [{ name: 'bash', command: 'cd /tmp && node --test work.test.mjs', exitCode: 0 }]
    expect(isVerifiedEvidence(record, facts)).toBe(true)
  })

  it('rejects a ref that only names a fragment of what ran', () => {
    const record = {
      id: 'e1',
      kind: 'test' as const,
      ref: 'node',
      status: 'pass' as const,
      acceptance: [1],
      at: NOW,
    }
    // 'node' is contained in the observed command, so the tolerant rule would
    // accept it; the observed text must therefore be quoted by the ref instead.
    const facts: ShellFact[] = [{ name: 'bash', command: 'node --test work.test.mjs', exitCode: 0 }]
    expect(observedCommand(record.ref, facts)).toBeDefined()
    // A ref naming something nobody ran stays unverified.
    expect(observedCommand('pytest', facts)).toBeUndefined()
  })

  it('never accepts a command that failed in the log', () => {
    const record = {
      id: 'e1',
      kind: 'command' as const,
      ref: 'npm run lint',
      status: 'pass' as const,
      acceptance: [1],
      at: NOW,
    }
    expect(isVerifiedEvidence(record, FACTS)).toBe(false)
  })
})

describe('file evidence verification', () => {
  const FILES: FileFact[] = [
    { name: 'read', path: '/tmp/work/notes.md' },
    { name: 'grep', path: 'src/app.ts' },
  ]

  it('accepts a file record whose path the session read', () => {
    expect(isVerifiedEvidence({
      id: 'e1',
      kind: 'file',
      ref: '/tmp/work/notes.md',
      status: 'pass',
      acceptance: [1],
      at: NOW,
    }, [], FILES)).toBe(true)
  })

  it('accepts a file record that names the path and then a detail', () => {
    expect(observedFile('/tmp/work/notes.md:8 export function titleCase', FILES)).toBeDefined()
  })

  it('rejects a file record naming a path nobody read', () => {
    expect(isVerifiedEvidence({
      id: 'e1',
      kind: 'file',
      ref: '/tmp/work/other.md',
      status: 'pass',
      acceptance: [1],
      at: NOW,
    }, [], FILES)).toBe(false)
  })

  it('never treats a file record as a re-runnable command', () => {
    const task: TaskState = {
      revision: 1,
      objective: 'x',
      status: 'active',
      acceptance: ['file exists'],
      evidence: [{
        id: 'e1',
        kind: 'file',
        ref: '/tmp/work/notes.md',
        status: 'pass',
        acceptance: [1],
        at: 1,
      }],
      decisions: [],
      createdAt: 1,
      updatedAt: 1,
    }
    expect(reverifiableCommands(task, [{ name: 'bash', command: '/tmp/work/notes.md', exitCode: 0 }]))
      .toEqual([])
  })
})
