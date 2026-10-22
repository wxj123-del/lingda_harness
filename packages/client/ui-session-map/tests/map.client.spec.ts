import { describe, expect, it } from 'vitest'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import { buildSessionMap, mapTurns, type MapChildInput } from '../src/client/map.ts'

const sid = (id: string) => id as SessionId
const turn = (n: number, prompt = `p${n}`, response = `r${n}`) => ({
  turn: n, seq: SessionSeq(n * 10), prompt, response,
})
const child = (id: string, turnCount: number | undefined, overrides: Partial<MapChildInput> = {}): MapChildInput => ({
  id: sid(id), title: id, updatedAt: 0, running: false, turnCount, ...overrides,
})

describe('mapTurns', () => {
  it('normalizes usable entries, drops damaged anchors, and sorts ascending', () => {
    expect(mapTurns([
      turn(2),
      { turn: 3, seq: -1 },
      { turn: -1, seq: 5 },
      { turn: 1.5, seq: 6 },
      null,
      'nope',
      { ...turn(1), prompt: 42, response: undefined },
    ])).toEqual([
      { turn: 1, seq: SessionSeq(10), prompt: '', response: '' },
      { turn: 2, seq: SessionSeq(20), prompt: 'p2', response: 'r2' },
    ])
  })

  it('reports no turns for a non-array projection value', () => {
    expect(mapTurns(undefined)).toEqual([])
    expect(mapTurns(null)).toEqual([])
    expect(mapTurns({ turns: [] })).toEqual([])
  })
})

describe('buildSessionMap', () => {
  it('attaches each branch to the turn its inherited count names', () => {
    const model = buildSessionMap(
      [turn(1), turn(2), turn(3)],
      [child('from-one', 1), child('from-three', 3)],
    )
    expect(model.turnCount).toBe(3)
    expect(model.branchCount).toBe(2)
    expect(model.rows.map(row => row.turn.turn)).toEqual([1, 2, 3])
    expect(model.rows[0]!.branches.map(branch => branch.id)).toEqual([sid('from-one')])
    expect(model.rows[1]!.branches).toEqual([])
    expect(model.rows[2]!.branches.map(branch => branch.id)).toEqual([sid('from-three')])
    expect(model.unattached).toEqual([])
  })

  it('reports a branch without an outline as unattached instead of guessing a row', () => {
    const model = buildSessionMap([turn(1), turn(2)], [child('unknown', undefined)])
    expect(model.unattached.map(branch => branch.id)).toEqual([sid('unknown')])
    expect(model.rows.every(row => row.branches.length === 0)).toBe(true)
  })

  it('reports a branch whose forked turn is no longer on the spine as unattached', () => {
    const model = buildSessionMap([turn(1)], [child('deeper', 4)])
    expect(model.unattached.map(branch => branch.id)).toEqual([sid('deeper')])
  })

  it('orders sibling branches newest first and carries their facts', () => {
    const model = buildSessionMap(
      [turn(1)],
      [
        child('older', 1, { updatedAt: 10, running: false }),
        child('newer', 1, { updatedAt: 20, running: true, title: 'Newer' }),
      ],
    )
    expect(model.rows[0]!.branches.map(branch => branch.id)).toEqual([sid('newer'), sid('older')])
    expect(model.rows[0]!.branches[0]).toMatchObject({ title: 'Newer', running: true, turns: 1 })
  })

  it('keeps an empty spine usable', () => {
    const model = buildSessionMap([], [child('orphan', 1)])
    expect(model).toMatchObject({ rows: [], turnCount: 0, branchCount: 1 })
    expect(model.unattached.map(branch => branch.id)).toEqual([sid('orphan')])
  })

  it('orders unattached branches newest first', () => {
    const model = buildSessionMap([turn(1)], [
      child('older', undefined, { updatedAt: 5 }),
      child('newer', undefined, { updatedAt: 50 }),
    ])
    expect(model.unattached.map(branch => branch.id)).toEqual([sid('newer'), sid('older')])
  })
})
