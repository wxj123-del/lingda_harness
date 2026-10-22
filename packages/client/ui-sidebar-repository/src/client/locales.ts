/**
 * `sidebarRepository` namespace dictionaries, and the namespace's declaration.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarRepository'>` or `PropsLocale<'sidebarRepository'>`
 * needs only this file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Source-control type name, guide entry, group headings, and failure lines. */
    sidebarRepository: SidebarRepositoryKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '源代码管理',
  'guide.title': '源代码管理',
  'guide.description': '查看分支、改动，暂存并提交',
  loading: '正在读取仓库…',
  noWorkspace: '这个会话没有工作区目录。',
  noRepository: '工作区不在 Git 仓库内。',
  noRepositoryHint: '在仓库目录里打开会话，这里就会显示它的分支和改动。',
  detachedHead: '当前处于分离 HEAD 状态。',
  reload: '重新读取',
  pull: '同步远端',
  pulling: '同步中…',
  stage: '暂存此文件',
  unstage: '取消暂存',
  stageAll: '全部暂存',
  unstageAll: '全部取消暂存',
  staged: '已暂存',
  changes: '更改',
  nothingStaged: '还没有暂存任何改动。',
  clean: '工作区没有未提交的改动。',
  commitPlaceholder: '提交说明（必填）',
  commit: '提交',
  committing: '提交中…',
  commitEmpty: '先填写提交说明。',
  commitNothing: '没有可提交的改动。',
  commitDone: '已提交 {sha}',
  ahead: '领先 {count}',
  behind: '落后 {count}',
  syncSynced: '已与远端一致',
  syncRemoteAhead: '远端有新提交',
  syncLocalAhead: '本地有未推送提交',
  syncDiverged: '本地与远端已分叉',
  syncDifferent: '与远端不同',
  syncUnknown: '未知同步状态',
  history: '最近提交',
  noHistory: '还没有提交记录。',
  fileAdded: '新增',
  fileModified: '修改',
  fileDeleted: '删除',
  fileRenamed: '重命名',
  fileUntracked: '未跟踪',
  fileConflicted: '冲突',
  fileOther: '其他',
  'error.unavailable': '读取失败：{message}',
} satisfies Record<string, string>

/** Source-control dictionary key union. */
export type SidebarRepositoryKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'type.label': 'Source Control',
  'guide.title': 'Source control',
  'guide.description': 'Inspect the branch and changes, stage them, and commit',
  loading: 'Reading the repository…',
  noWorkspace: 'This session has no workspace directory.',
  noRepository: 'This workspace is not inside a Git repository.',
  noRepositoryHint: 'Open a session in a repository directory to see its branch and changes here.',
  detachedHead: 'This checkout is in a detached HEAD state.',
  reload: 'Reload',
  pull: 'Sync from remote',
  pulling: 'Syncing…',
  stage: 'Stage this file',
  unstage: 'Unstage',
  stageAll: 'Stage all',
  unstageAll: 'Unstage all',
  staged: 'Staged',
  changes: 'Changes',
  nothingStaged: 'Nothing is staged yet.',
  clean: 'No uncommitted changes in this workspace.',
  commitPlaceholder: 'Commit message (required)',
  commit: 'Commit',
  committing: 'Committing…',
  commitEmpty: 'Write a commit message first.',
  commitNothing: 'There is nothing to commit.',
  commitDone: 'Committed {sha}',
  ahead: '{count} ahead',
  behind: '{count} behind',
  syncSynced: 'Up to date with the remote',
  syncRemoteAhead: 'The remote has newer commits',
  syncLocalAhead: 'Local commits are not pushed',
  syncDiverged: 'Local and remote have diverged',
  syncDifferent: 'Different from the remote',
  syncUnknown: 'Unknown sync state',
  history: 'Recent commits',
  noHistory: 'No commits yet.',
  fileAdded: 'Added',
  fileModified: 'Modified',
  fileDeleted: 'Deleted',
  fileRenamed: 'Renamed',
  fileUntracked: 'Untracked',
  fileConflicted: 'Conflicted',
  fileOther: 'Other',
  'error.unavailable': 'Read failed: {message}',
} satisfies Record<SidebarRepositoryKey, string>
