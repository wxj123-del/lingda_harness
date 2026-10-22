# Agent Note: Desk pet reports task progress

Status: implemented

English | [中文](2026-10-22-desk-pet-task-progress.zh.md)

## Problem

A Desktop run can take minutes, and the window that shows the work is usually behind something else. The mascot already carried the product's identity in the sidebar and the New Session hero, but nothing outside the application window told the user whether work was still moving, how far it had got, or that it had just finished.

## Decision

`apps/desktop` gains a second window, `dsh-app://shell/pet.html`: frameless, transparent, always on top at the `screen-saver` level, visible on all workspaces and full-screen spaces, skipped by the taskbar and window switcher, and `focusable: false`. Its whole surface is a drag handle — pointer movement is forwarded as deltas through IPC and applied with `setPosition`, so dragging moves the OS window rather than a sprite inside it. The application menu toggles it, and `DSH_DESKTOP_PET=0` starts the shell without it.

The pet polls the Host's own `/api/session/list` carrier every two seconds while something runs and every eight while idle, then folds the reply in `pet-state.ts` (pure, testable): Sessions that report `running` and are not blank count as work; the followed Session is the newest one that carries a `todos` projection, falling back to the newest running one; its tally becomes the bubble's meter and the first `in_progress` entry becomes its line. When work stops, `pet.ts` latches a six-second `done` phase — the laughing face — then returns to idle.

Both mascot states are embedded in `renderer/pet.js` as WebP data URLs (the front view for working and idle, the closed-eye laugh for done), so the pet needs no asset pipeline and no network. It is framework-free because the window exists while the application's own renderer is still booting.

## Alternatives considered

**Render the pet inside the application window over a transparent region.** The web renderer cannot draw outside its window, and a pet that disappears when the window is hidden or minimised — exactly when the user is doing something else — fails the feature's purpose.

**Boot a second Host for the pet.** The pet needs one read: the Session list. A second Host would double the process, duplicate the projection cache, and loosen the "one Host per Desktop" invariant that recovery and plugin changes rely on.

**Drive the pet from the application renderer through a shared store.** That couples the pet's liveness to the main document: a renderer crash or a navigation to the startup page would silently freeze the pet, which is the moment its state matters most.

**Use a vector mascot instead of the artwork.** Tried and rejected earlier for the brand mark: the sheet's rendering reads clearly at 24px while vectorised versions blur, and the two expressions needed here exist only as artwork.

## Consequences

The pet is a second always-on-top window, so `before-quit` closes it explicitly to keep `window-all-closed` from firing on platforms that quit with it. It holds no Host state of its own: if the backend is restarting, the poll fails and the pet shows idle, then resumes on the next tick. A user who never wants it can set `DSH_DESKTOP_PET=0`; the menu toggle lasts only for the running session, which keeps the launch state predictable. The poll is a normal RPC each tick, so the pet costs one request per two seconds while work runs.

## Verification

- `apps/desktop/tests/pet-state.spec.ts` pins the fold: running/blank filters, newest-todo Session selection, missing-projection fallback, malformed entries, and the RPC envelope.
- `apps/desktop/tests/pet.client.spec.ts` pins the window driver: initial placement, working/idle poll cadence, the latched celebration, drag deltas and saved corner, backend-unavailable idle, and dispose.
- `apps/desktop/tests/pet-renderer.spec.ts` pins the renderer contract in jsdom: the three phases, meter width, and drag IPC on pointer gestures.
- Verified live in the packaged-shell development run: a real prompt moved the pet from idle to working, through 33/67/100 percent of a real `todo_write` list, to the settled phase; three drag deltas moved the window by exactly their sum.
