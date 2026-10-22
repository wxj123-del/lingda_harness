/**
 * Session map derivation: one row per completed turn of the viewed Session,
 * with the Sessions forked from each turn attached to it. Pure over wire
 * values so the map renders from list and projection data alone.
 */
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'

/** One turn on the spine, as the `turnOutline` projection serves it. */
export interface MapTurn {
  /** Host-assigned turn number. */
  turn: number
  /** The turn's `turn/start` seq, the fork anchor for this row. */
  seq: SessionSeq
  /** Bounded first-prompt preview. */
  prompt: string
  /** Bounded final-response preview. */
  response: string
}

/** One forked Session shown beside its fork turn. */
export interface MapBranch {
  id: SessionId
  title: string
  /** Turns the branch inherited, i.e. the source turn it forked after; 0 when unknown. */
  forkAfter: number
  /** Turns the branch has run in total, inherited ones included; absent when its outline is unknown. */
  turns: number | undefined
  running: boolean
  updatedAt: number
}

/** One spine row: a turn plus every branch forked from it. */
export interface MapRow {
  turn: MapTurn
  branches: readonly MapBranch[]
}

/** The derived map for one Session. */
export interface SessionMapModel {
  /** Spine rows in ascending turn order. */
  rows: readonly MapRow[]
  /** Branches whose fork point cannot be placed on the spine. */
  unattached: readonly MapBranch[]
  turnCount: number
  branchCount: number
}

/** Raw child facts the map needs; absent `turnCount` means the outline was unavailable. */
export interface MapChildInput {
  id: SessionId
  title: string
  updatedAt: number
  running: boolean
  turnCount: number | undefined
}

/**
 * Narrow one wire outline entry. `turn` and `seq` anchor the row and its fork,
 * so damage to either drops the entry; the previews are decorative and degrade
 * to an empty string.
 * @param value - one element of the projection value.
 * @returns the normalized turn, or undefined when the anchor is unusable.
 */
function mapTurn(value: unknown): MapTurn | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as { turn?: unknown; seq?: unknown; prompt?: unknown; response?: unknown }
  if (typeof entry.turn !== 'number' || !Number.isSafeInteger(entry.turn) || entry.turn < 0) return undefined
  if (typeof entry.seq !== 'number' || !Number.isSafeInteger(entry.seq) || entry.seq < 0 || Object.is(entry.seq, -0)) {
    return undefined
  }
  return {
    turn: entry.turn,
    seq: SessionSeq(entry.seq),
    prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
    response: typeof entry.response === 'string' ? entry.response : '',
  }
}

/**
 * Normalize the `turnOutline` projection value into ascending turns.
 * @param outline - projection value treated as wire data.
 * @returns usable turns, ascending by turn number.
 */
export function mapTurns(outline: unknown): MapTurn[] {
  if (!Array.isArray(outline)) return []
  const turns = outline.flatMap((entry) => {
    const turn = mapTurn(entry)
    return turn === undefined ? [] : [turn]
  })
  return turns.sort((a, b) => a.turn - b.turn)
}

/**
 * Build the map for one viewed Session.
 *
 * A fork inherits every turn before its cut, so a child's inherited turn count
 * names the parent turn it branched after. Children whose own outline is
 * unavailable cannot be placed and are reported unattached instead of being
 * guessed onto the nearest row.
 * @param outline - the viewed Session's `turnOutline` projection value.
 * @param children - ordinary child Sessions of the viewed Session.
 * @returns the spine rows with their branches, plus the unplaced ones.
 */
export function buildSessionMap(outline: unknown, children: readonly MapChildInput[]): SessionMapModel {
  const turns = mapTurns(outline)
  const byTurn = new Map(turns.map(turn => [turn.turn, [] as MapBranch[]]))
  const unattached: MapBranch[] = []
  for (const child of children) {
    const branch: MapBranch = {
      id: child.id,
      title: child.title,
      forkAfter: child.turnCount ?? 0,
      turns: child.turnCount,
      running: child.running,
      updatedAt: child.updatedAt,
    }
    const row = child.turnCount === undefined ? undefined : byTurn.get(child.turnCount)
    if (row === undefined) unattached.push(branch)
    else row.push(branch)
  }
  return {
    rows: turns.map(turn => ({
      turn,
      branches: (byTurn.get(turn.turn) as MapBranch[]).sort((a, b) => b.updatedAt - a.updatedAt),
    })),
    unattached: unattached.sort((a, b) => b.updatedAt - a.updatedAt),
    turnCount: turns.length,
    branchCount: children.length,
  }
}
