/**
 * `sessionMap` namespace dictionaries: the session-map View tab, its spine
 * rows, branch chips, and the empty and degraded states.
 *
 * Counted copy carries `.one`/`.other` pairs. Chinese spells both sides the
 * same, as it has no plural form; English differs, so the component picks the
 * key from the count.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.map': '地图',
  'map.title': '会话地图',
  'map.subtitle': '把当前会话的回合与其分叉画成一条主线',
  'map.turns.one': '{n} 个回合',
  'map.turns.other': '{n} 个回合',
  'map.branches.one': '{n} 个分支',
  'map.branches.other': '{n} 个分支',
  'map.empty': '这个会话还没有完成的回合',
  'map.emptyHint': '发送第一条消息后，每轮对话都会成为地图上的一格',
  'map.turn': '第 {n} 轮',
  'map.noPrompt': '（无提示词）',
  'map.branchHere': '从这里分叉',
  'map.branches': '分支',
  'map.unattached': '未能定位的分支',
  'map.unattachedHint': '这些分支缺少自己的回合大纲，无法判断从哪一轮分出',
  'map.branchTurns.one': '{n} 轮',
  'map.branchTurns.other': '{n} 轮',
  'map.branchTurnsUnknown': '轮次未知',
  'map.branchRunning': '运行中',
  'map.forkFailed': '分叉失败：{reason}',
  'map.disabled': '会话忙碌时不能分叉',
} satisfies Record<string, string>

/** The session-map namespace key union. */
export type SessionMapKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'view.map': 'Map',
  'map.title': 'Session map',
  'map.subtitle': 'The viewed Session as one spine of turns, with its forks',
  'map.turns.one': '{n} turn',
  'map.turns.other': '{n} turns',
  'map.branches.one': '{n} branch',
  'map.branches.other': '{n} branches',
  'map.empty': 'This Session has no completed turns yet',
  'map.emptyHint': 'Send the first message and every turn lands on the map',
  'map.turn': 'Turn {n}',
  'map.noPrompt': '(no prompt)',
  'map.branchHere': 'Branch from here',
  'map.branches': 'Branches',
  'map.unattached': 'Branches without a fork point',
  'map.unattachedHint': 'These branches have no turn outline of their own, so their source turn is unknown',
  'map.branchTurns.one': '{n} turn',
  'map.branchTurns.other': '{n} turns',
  'map.branchTurnsUnknown': 'Turn count unknown',
  'map.branchRunning': 'Running',
  'map.forkFailed': 'Branch failed: {reason}',
  'map.disabled': 'A busy Session cannot be branched',
} satisfies Record<SessionMapKey, string>
