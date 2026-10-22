import { describe, expect, it } from 'vitest'
import {
  appendAutoEvidence,
  applyTaskPatch,
  renderTaskCard,
  taskView,
  uncoveredAcceptance,
} from '../src/state.ts'
import type { TaskState } from '../src/types.ts'

const NOW = 1_700_000_000_000

function makeTask(): TaskState {
  return applyTaskPatch(null, {
    objective: 'Ship the search engine',
    acceptance: ['tests pass', 'cli works'],
  }, NOW)
}

describe('task state mutations', () => {
  it('creates a first task with acceptance and revision 1', () => {
    const task = makeTask()
    expect(task.revision).toBe(1)
    expect(task.objective).toBe('Ship the search engine')
    expect(task.status).toBe('active')
    expect(task.acceptance).toEqual(['tests pass', 'cli works'])
    expect(task.createdAt).toBe(NOW)
  })

  it('requires an objective to create', () => {
    expect(() => applyTaskPatch(null, {}, NOW)).toThrow(/requires objective/)
    expect(() => applyTaskPatch(null, { objective: '   ' }, NOW)).toThrow(/non-empty/)
  })

  it('bumps revision and preserves earlier acceptance indices', () => {
    const first = makeTask()
    const second = applyTaskPatch(first, { acceptance: ['tests pass', 'docs updated'] }, NOW + 1)
    expect(second.revision).toBe(2)
    expect(second.acceptance).toEqual(['tests pass', 'cli works', 'docs updated'])
  })

  it('records evidence with coverage indices', () => {
    const task = applyTaskPatch(makeTask(), {
      evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] }],
    }, NOW + 1)
    expect(task.evidence).toHaveLength(1)
    expect(task.evidence[0]).toMatchObject({ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] })
    expect(uncoveredAcceptance(task)).toEqual([2])
  })

  it('rejects out-of-range acceptance indices', () => {
    expect(() => applyTaskPatch(makeTask(), {
      evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [3] }],
    }, NOW)).toThrow(/outside 1\.\.2/)
  })

  it('rejects success while acceptance lacks passing evidence', () => {
    expect(() => applyTaskPatch(makeTask(), { status: 'succeeded' }, NOW))
      .toThrow(/acceptance 1, 2 lack passing evidence/)
  })

  it('rejects success with no acceptance criteria at all', () => {
    const bare = applyTaskPatch(null, { objective: 'do it' }, NOW)
    expect(() => applyTaskPatch(bare, { status: 'succeeded' }, NOW))
      .toThrow(/without acceptance criteria/)
  })

  it('allows success once every criterion has passing evidence', () => {
    const evidenced = applyTaskPatch(makeTask(), {
      evidence: [
        { kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] },
        { kind: 'command', ref: 'node cli.mjs search x', status: 'pass', acceptance: [2] },
      ],
    }, NOW + 1)
    const done = applyTaskPatch(evidenced, { status: 'succeeded' }, NOW + 2)
    expect(done.status).toBe('succeeded')
    expect(uncoveredAcceptance(done)).toEqual([])
  })

  it('ignores failing evidence when computing coverage', () => {
    const task = applyTaskPatch(makeTask(), {
      evidence: [
        { kind: 'test', ref: 'npm test', status: 'fail', acceptance: [1] },
        { kind: 'test', ref: 'npm test', status: 'pass', acceptance: [2] },
      ],
    }, NOW + 1)
    expect(uncoveredAcceptance(task)).toEqual([1])
  })

  it('caps retained evidence by dropping the oldest automatic record', () => {
    let task = makeTask()
    for (let index = 0; index < 45; index++) {
      task = appendAutoEvidence(task, { kind: 'command', ref: `cmd ${String(index)}`, status: 'pass' }, NOW + index)
    }
    expect(task.evidence).toHaveLength(40)
    expect(task.evidence[0]?.ref).toBe('cmd 5')
    expect(task.evidence.at(-1)?.ref).toBe('cmd 44')
  })

  it('retains the newest decisions only', () => {
    let task = makeTask()
    for (let index = 0; index < 25; index++) {
      task = applyTaskPatch(task, { decision: `decision ${String(index)}` }, NOW + index)
    }
    expect(task.decisions).toHaveLength(20)
    expect(task.decisions[0]?.text).toBe('decision 5')
  })
})

describe('task rendering', () => {
  it('renders a compact card with uncovered acceptance marked', () => {
    const task = applyTaskPatch(makeTask(), {
      evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] }],
      decision: 'Use BM25',
    }, NOW + 1)
    const card = renderTaskCard(task)
    expect(card).toContain('<task_state>')
    expect(card).toContain('Objective: Ship the search engine')
    expect(card).toContain('1. tests pass [covered]')
    expect(card).toContain('2. cli works [MISSING EVIDENCE]')
    expect(card).toContain('- Use BM25')
    expect(card).toContain('</task_state>')
  })

  it('truncates a long objective to keep the card bounded', () => {
    const task = applyTaskPatch(null, { objective: 'x'.repeat(400) }, NOW)
    const card = renderTaskCard(task)
    expect(card.split('\n')[1]?.length).toBeLessThan(260)
    expect(card).toContain('…')
  })

  it('reports recent failing evidence', () => {
    const task = applyTaskPatch(makeTask(), {
      evidence: [{ kind: 'command', ref: 'npm test -- --watch', status: 'fail' }],
    }, NOW + 1)
    expect(renderTaskCard(task)).toContain('- command: npm test -- --watch')
  })

  it('renders a JSON view with coverage flags', () => {
    const task = applyTaskPatch(makeTask(), {
      evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] }],
    }, NOW + 1)
    const view = taskView(task)
    expect(view).toMatchObject({
      task: {
        revision: 2,
        uncovered: [2],
        acceptance: [
          { index: 1, text: 'tests pass', covered: true },
          { index: 2, text: 'cli works', covered: false },
        ],
      },
    })
  })

  it('renders a null task view before the first write', () => {
    expect(taskView(null)).toEqual({ task: null })
  })
})

describe('card progress', () => {
  it('reports cumulative spend when a meter value is present', () => {
    const task = applyTaskPatch(null, { objective: 'Spend', acceptance: ['done'] }, NOW)
    const card = renderTaskCard(task, {
      uncachedInputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 5000,
    })
    expect(card).toContain('Spent so far: 1,540 tokens (in 1,200, out 340, 5,000 cached)')
  })

  it('omits the cached clause when nothing was cached', () => {
    const task = applyTaskPatch(null, { objective: 'Spend', acceptance: ['done'] }, NOW)
    const card = renderTaskCard(task, { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 0 })
    expect(card).toContain('Spent so far: 15 tokens (in 10, out 5)')
    expect(card).not.toContain('cached')
  })

  it('omits the line entirely without a meter', () => {
    const task = applyTaskPatch(null, { objective: 'Spend', acceptance: ['done'] }, NOW)
    expect(renderTaskCard(task)).not.toContain('Spent so far')
  })
})
