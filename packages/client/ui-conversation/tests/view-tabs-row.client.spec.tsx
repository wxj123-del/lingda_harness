// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ViewTabsRow } from '../src/client/settings/ViewTabsRow.tsx'
import type { ViewTabsRowProps } from '../src/client/settings/ViewTabsRow.tsx'
import { ComposerSubmissionPolicy } from '../src/client/input/submission-policy.ts'
import { en } from '../src/client/locales.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noPendingInteraction() {
  return bindSnapshotSelector(createSnapshotStore<SessionPendingInteractionSnapshot>(new Map()))
}

function mount() {
  const policy = new ComposerSubmissionPolicy()
  const setShowViewTabs = vi.fn((visible: boolean) => { policy.setShowViewTabs(visible) })
  const props: ViewTabsRowProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: emptySessions(),
    useSessionPendingInteraction: noPendingInteraction(),
    useResource,
    useWorkspaces: emptyWorkspaces(),
    useShowViewTabs: bindSnapshotSelector(policy.showViewTabs),
    setShowViewTabs,
    t: makeTranslate(en),
  }
  render(<ViewTabsRow {...props} />)
  return { policy, setShowViewTabs }
}

describe('ViewTabsRow', () => {
  it('describes the switcher and starts switched off', () => {
    mount()
    expect(screen.getByText('Show session view tabs')).toBeDefined()
    expect(screen.getByText(/Token trace, Map, Workflow, Repository and Terminal/)).toBeDefined()
    expect(screen.getByText(/More views menu/)).toBeDefined()
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false)
  })

  it('publishes the new preference when toggled', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('switch'))
    expect(b.setShowViewTabs).toHaveBeenCalledWith(true)
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true)
  })
})
