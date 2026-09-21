// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { GeneralSectionComponentProps } from '../src/client/GeneralSection.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import type { TriggerContentProps } from '../src/client/chrome.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import { UpdateRow } from '../src/client/UpdateRow.tsx'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

/** Store over a real mirror derived from the same scripted context. */
function derivedDocumentStore(remote: object) {
  const ctx = { remote } as never
  return new SettingsDocumentStore(ctx, new SettingsDescribeMirror(ctx))
}
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (globalThis as { dshDesktop?: unknown }).dshDesktop
})

// The seat's key domain is settings ∪ common; the stub answers from the
// package dictionary and falls back to the key like the real chain.
const t: TriggerContentProps['t'] = key => (en as Record<string, string>)[key] ?? key

// Global standard kit stubs: none of these components consume the hooks.
const unusedHook = (() => { throw new Error('unused by settings-general components') }) as never
type AttentionSnapshot = Parameters<Parameters<TriggerContentProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: TriggerContentProps['useSessionPendingInteraction'] = selector => selector(noAttention)
const kit = { useSessions: unusedHook, useSessionPendingInteraction, usePanelInfo, useResource, useWorkspaces: unusedHook }

describe('chrome content', () => {
  it('TriggerContent renders the icon with the label in the wide column', () => {
    const { container } = render(<TriggerContent {...kit} wide t={t} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('TriggerContent drops the label in the rail state', () => {
    const { container } = render(<TriggerContent {...kit} wide={false} t={t} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('HeaderContent and CloseLabel render their translated text', () => {
    render(<HeaderContent {...kit} t={t} />)
    render(<CloseLabel {...kit} t={t} />)
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Close')).toBeTruthy()
  })
})

describe('GeneralSection', () => {
  function mount() {
    const renderSlot = vi.fn(
      ((key: string) => <div data-testid={`slot-${key}`} />) as GeneralSectionComponentProps['renderSlot'],
    )
    const props: GeneralSectionComponentProps = { ...kit, renderSlot, close: vi.fn() }
    const view = render(<GeneralSection {...props} />)
    return { view, renderSlot }
  }

  it('renders the item slot as the section body', () => {
    const { renderSlot } = mount()
    expect(renderSlot).toHaveBeenCalledWith('settings.general.item', {})
    expect(screen.getByTestId('slot-settings.general.item')).toBeTruthy()
  })
})

describe('UpdateRow', () => {
  it('renders a source checkout row outside the Electron application bridge', () => {
    render(<UpdateRow {...kit} t={t} />)
    expect(screen.getByText('Software updates')).toBeTruthy()
    expect(screen.getByText('Source checkout: check GitCode commits')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy()
  })

  it('checks the GitCode source commit outside Electron', async () => {
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', '1234567')
    const fetch = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ sha: 'abcdef0123456789' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))
    vi.stubGlobal('fetch', fetch)
    render(<UpdateRow {...kit} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('Update available · abcdef0')).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith(
      'https://api.gitcode.com/api/v5/repos/XJ-Cyber/lingda-harness/commits/main',
      { headers: { Accept: 'application/json' } },
    )
  })

  it('checks the Host checkout on mount and offers an in-app fast-forward update', async () => {
    const check = vi.fn(() => Promise.resolve({ ok: true as const, value: {
      repositoryRoot: '/tmp/project', remote: 'gitcode', branch: 'main', remoteBranch: 'main',
      localHead: '1234567', remoteHead: 'abcdef0123456789', ahead: 0, behind: 1, state: 'available' as const,
    } }))
    const update = vi.fn(() => Promise.resolve({ ok: true as const, value: {
      repositoryRoot: '/tmp/project', remote: 'gitcode', branch: 'main', remoteBranch: 'main',
      localHead: 'abcdef0123456789', remoteHead: 'abcdef0123456789', ahead: 0, behind: 0, state: 'current' as const,
      updated: true, restartScheduled: false,
    } }))
    render(<UpdateRow {...kit} t={t} repository={{ check, update }} />)
    expect(await screen.findByText('Update available · abcdef0')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }))
    await waitFor(() => { expect(update).toHaveBeenCalledOnce() })
    expect(await screen.findByText('Update complete, restart the application')).toBeTruthy()
  })

  it('checks for a release and renders the current status', async () => {
    const check = vi.fn(() => Promise.resolve({ phase: 'idle' as const }))
    Object.defineProperty(globalThis, 'dshDesktop', {
      configurable: true,
      value: { updates: { check, install: vi.fn(), subscribe: vi.fn(() => () => {}) } },
    })
    render(<UpdateRow {...kit} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => { expect(check).toHaveBeenCalledOnce() })
    expect(screen.getByText('You are up to date')).toBeTruthy()
  })

  it('offers install when the bridge reports an available release', async () => {
    const listeners: Array<(state: { phase: 'available'; version: string }) => void> = []
    const install = vi.fn(() => Promise.resolve())
    Object.defineProperty(globalThis, 'dshDesktop', {
      configurable: true,
      value: {
        updates: {
          check: vi.fn(), install,
          subscribe: (listener: (state: { phase: 'available'; version: string }) => void) => {
            listeners.push(listener)
            return () => {}
          },
        },
      },
    })
    render(<UpdateRow {...kit} t={t} />)
    listeners[0]!({ phase: 'available', version: '1.2.3' })
    expect(await screen.findByText('Update available · 1.2.3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }))
    await waitFor(() => { expect(install).toHaveBeenCalledOnce() })
  })

  it('renders every updater state and reports rejected checks', async () => {
    const listeners: Array<(state: { phase: string; version?: string; message?: string }) => void> = []
    const pending = Promise.withResolvers<{ phase: 'idle' }>()
    const check = vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockRejectedValueOnce('offline')
    Object.defineProperty(globalThis, 'dshDesktop', {
      configurable: true,
      value: {
        updates: {
          check, install: vi.fn(),
          subscribe: (listener: (state: { phase: string; version?: string; message?: string }) => void) => {
            listeners.push(listener)
            return () => {}
          },
        },
      },
    })
    render(<UpdateRow {...kit} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(screen.getByRole('button', { name: 'Check for updates' })).toHaveProperty('disabled', true)
    await act(async () => { pending.resolve({ phase: 'idle' }); await pending.promise })
    for (const state of [
      { phase: 'checking' as const },
      { phase: 'installing' as const },
      { phase: 'ready' as const },
      { phase: 'error' as const },
      { phase: 'error' as const, message: 'broken' },
      { phase: 'available' as const },
    ]) {
      act(() => { listeners[0]!(state) })
      expect(screen.getByText(
        state.phase === 'checking' ? 'Checking for updates…'
          : state.phase === 'installing' ? 'Installing update…'
            : state.phase === 'ready' ? 'Update installed, restarting…'
              : state.phase === 'error' ? (state.message ?? 'Update check failed')
                : 'Update available ·',
      )).toBeTruthy()
    }
    act(() => { listeners[0]!({ phase: 'idle' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect((await screen.findByRole('alert')).textContent).toBe('network unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect((await screen.findByRole('alert')).textContent).toBe('offline')
    expect(check).toHaveBeenCalledTimes(3)
  })
})

describe('SettingsDocumentAction', () => {
  it('appears only for a file-backed provider and requests its Host-owned document', async () => {
    const openDocument = vi.fn(() => Promise.resolve({
      ok: true as const, value: { opened: true as const },
    }))
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          ok: true as const,
          value: { writable: true, hasDocument: true, namespaces: [] },
        })),
        openSettingsDocument: openDocument,
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    const action = await screen.findByRole('button', { name: 'Open configuration file' })
    fireEvent.click(action)
    await waitFor(() => { expect(openDocument).toHaveBeenCalledWith() })
  })

  it('stays absent without a document and follows a mirror refresh to available', async () => {
    const describe = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } })
      .mockResolvedValueOnce({ ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } })
    const ctx = { remote: { settings: { describe, openSettingsDocument: vi.fn() } } } as never
    const mirror = new SettingsDescribeMirror(ctx)
    const controller = new SettingsDocumentStore(ctx, mirror)
    const first = render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(screen.queryByRole('button', { name: 'Open configuration file' })).toBeNull()
    first.unmount()
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    // A remount alone re-reads nothing; availability moves with the mirror's
    // own refresh (a document commit or reconnect in production).
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(describe).toHaveBeenCalledTimes(1)
    await mirror.load()
    expect(await screen.findByRole('button', { name: 'Open configuration file' })).toBeTruthy()
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('keeps the action available and reports a native-open failure', async () => {
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          ok: true as const,
          value: { writable: true, hasDocument: true, namespaces: [] },
        })),
        openSettingsDocument: vi.fn(() => Promise.resolve({
          ok: false as const,
          error: new RemoteError('gateway/internal', 'xdg-open missing', {}),
        })),
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open configuration file')
    expect(screen.getByRole('button', { name: 'Open configuration file' })).toBeTruthy()
  })
})
