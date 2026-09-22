/** Built-in workflow templates used by the Workflow authoring console. */
import type { LayoutKey } from './client/locales.ts'

export interface BuiltinWorkflow {
  readonly name: string
  readonly title: LayoutKey
  readonly description: LayoutKey
  readonly body: LayoutKey
  readonly steps: readonly LayoutKey[]
}

/** Small, deterministic templates that exercise the workflow editor. */
export const BUILTIN_WORKFLOWS: readonly BuiltinWorkflow[] = [
  {
    name: 'meeting-summary',
    title: 'builtin.workflow.template.meeting.title',
    description: 'builtin.workflow.template.meeting.description',
    body: 'builtin.workflow.template.meeting.body',
    steps: [
      'builtin.workflow.template.meeting.step1',
      'builtin.workflow.template.meeting.step2',
      'builtin.workflow.template.meeting.step3',
    ],
  },
  {
    name: 'research-brief',
    title: 'builtin.workflow.template.research.title',
    description: 'builtin.workflow.template.research.description',
    body: 'builtin.workflow.template.research.body',
    steps: [
      'builtin.workflow.template.research.step1',
      'builtin.workflow.template.research.step2',
      'builtin.workflow.template.research.step3',
    ],
  },
  {
    name: 'content-review',
    title: 'builtin.workflow.template.review.title',
    description: 'builtin.workflow.template.review.description',
    body: 'builtin.workflow.template.review.body',
    steps: [
      'builtin.workflow.template.review.step1',
      'builtin.workflow.template.review.step2',
      'builtin.workflow.template.review.step3',
    ],
  },
]
