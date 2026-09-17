export type LocalSkillSource = 'codex' | 'agents'

export type LocalSkillIssue =
  | 'invalidMetadata'
  | 'emptyBody'
  | 'tooLarge'
  | 'unsafePath'
  | 'multipleSkills'
  | 'unreadable'

export interface LocalSkillCandidate {
  id: string
  name: string
  description: string
  source: LocalSkillSource
  sourcePath: string
  relativePath: string
  fileCount: number
  expandedBytes: number
  issue: LocalSkillIssue | null
}

export interface LocalSkillRoot {
  source: LocalSkillSource
  path: string
  available: boolean
}

export interface LocalSkillScan {
  candidates: LocalSkillCandidate[]
  roots: LocalSkillRoot[]
  scannedAt: number
}

export interface LocalSkillArchive {
  archive: string
}
