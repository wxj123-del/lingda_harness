import { describe, expect, it } from 'vitest'
import { isWorkflowPublished, latestWorkflowVersion, releasedWorkflow, type AuthoringItem, type WorkflowVersion } from '../src/authoring-settings.ts'

const release = (version: number, title: string): WorkflowVersion => ({
  version,
  publishedAt: version,
  title,
  description: `${title} description`,
  body: `${title} body`,
  steps: [`${title} step`],
  nodes: [
    { id: 'start', kind: 'start', title: 'Start', instructions: '', x: 0, y: 0 },
    { id: 'end', kind: 'end', title: 'End', instructions: '', x: 200, y: 0 },
  ],
  edges: [{ id: 'edge', source: 'start', target: 'end' }],
})

function workflow(patch: Partial<AuthoringItem> = {}): AuthoringItem {
  return { id: 'workflow-release', title: 'Draft title', description: 'Draft description', enabled: true, body: 'Draft body', steps: [], updatedAt: 1, ...patch }
}

describe('workflow release selection', () => {
  it('keeps a draft without a published snapshot out of normal execution', () => {
    const item = workflow({ workflowStatus: 'draft', version: 0, versions: [] })
    expect(isWorkflowPublished(item)).toBe(false)
    expect(releasedWorkflow(item)).toBeUndefined()
  })

  it('runs the latest immutable release while newer draft edits remain isolated', () => {
    const item = workflow({ workflowStatus: 'draft', version: 2, versions: [release(2, 'Release 2'), release(1, 'Release 1')] })
    expect(latestWorkflowVersion(item)?.version).toBe(2)
    const live = releasedWorkflow(item)
    expect(live).toMatchObject({ id: item.id, title: 'Release 2', body: 'Release 2 body', workflowStatus: 'published', version: 2 })
    expect(live?.nodes).not.toBe(item.versions?.[0]?.nodes)
    expect(isWorkflowPublished(item)).toBe(true)
  })

  it('keeps legacy workflows runnable until lifecycle metadata is migrated', () => {
    const item = workflow()
    expect(releasedWorkflow(item)).toBe(item)
    expect(isWorkflowPublished(item)).toBe(true)
  })
})
