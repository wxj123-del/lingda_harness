# Agent Note: Workspace flow overview

Status: implemented

English | [中文](2026-10-18-workspace-flow-overview.zh.md)

## Problem

A Workspace groups every Session that touches one directory, but the browser lists them by recency or manual position alone. Nothing answers which conversations in that folder still need attention, which are running, which started their own task list, and which are finished. Users had to open each row and read the transcript or task panel to reconstruct that picture.

## Decision

The Workspace row's `...` menu gains **Flow overview**. It opens a **page** in the layout's main column — not a dialog — showing a board with one column per stage: **Waiting for you**, **Working**, **In progress**, **To do**, and **Completed**. Each card carries the Session title, its last activity, and — when the Session has a `todos` projection — a progress bar with the completed-to-total count. Choosing a card opens that Session and leaves the page.

The page header names the Workspace with its session and completion counts, offers **Switch workspace** to retarget the board at another Workspace, and **Back to conversation**. The package also registers a **Flow** row in the sidebar's global-panel navigation (`sidebar.panellist` plus the `main` keyed slot entry `workspace-flow`), so the page reopens on the last shown Workspace instead of an empty board. Selecting any main panel collapses the sidebar to its rail — existing layout behavior, unchanged here.

`deriveWorkspaceFlow` (`packages/client/ui-workspace/src/client/flow.ts`) is a pure projection over the same list snapshot the rows already read. Stage precedence is fixed:

1. A pending interaction (`approval`, `plan-review`, `question`) → **Waiting for you**.
2. The Session's own running bit or any running descendant through uninterrupted subagent lineage → **Working**.
3. A blank provisional Session → **To do**.
4. A non-empty `todos` list: any `in_progress` entry → **In progress**; all entries `completed` → **Completed**; otherwise → **To do**.
5. Without a list, `turnOutline`: an empty outline is a Session that never started a turn → **To do**; a non-empty outline → **Completed**.
6. Unknown outline (cold row without a projection checkpoint) → **Completed**.

Archived Sessions and subagent-origin rows never appear, matching the browser's list. Columns keep that fixed order and sort newest first, with the Session id as tie-break.

Browser and page share one viewing-store handle, so the folder menu writes `flowTarget` through the actions it already receives and the page reads the same root instance; the injected `openFlow` callback only selects the main panel. Two type-only package edges carry the projection declarations: `@deepseek-ai/dsh-tool-todo/client` for `todos` and `@deepseek-ai/dsh-session-turn-outline/client` for `turnOutline`. Neither runtime is imported.

## Alternatives considered

**An overview dialog** was the first implementation and was rejected on review: a Workspace's flow is a standing view users compare across sessions, and a dialog is transient, re-derives nothing once dismissed, and cannot be returned to. The page also gives each stage a real column instead of a stacked list. **Deriving stages from the transcript** was rejected: it would require opening every Session in the Workspace, which the list snapshot deliberately avoids. **A separate Host-side stage projection** was rejected because every input already rides the list (`running`, `completed`, `todos`, `turnOutline`), so a new durable key would add a wire format and cache row to re-derive facts that already exist. **A nested Sessions submenu on the row** was rejected: the point is to compare stages across the whole folder, which a recency-ordered list cannot show. **Classifying a listless, never-started Session as Completed** (the first implementation) was rejected after the tests showed it claimed settled work for Sessions nobody had prompted yet; `turnOutline` supplies the missing start-state witness. **Treating an unknown outline as To do** was rejected: a cold row's missing checkpoint is not evidence of pending work, so it falls through to Completed instead of inventing an obligation. **Storing the page target in the browser's local state** was rejected: the page lives in a different slot entry from the menu, so the target has to survive the sidebar remounting and the page reopening from the sidebar row — the shared persisted store is the one channel both entries read.

## Consequences

The overview is read-only: it starts no run, changes no Session, and writes nothing durable. Of all its state only `flowTarget` persists, as a new key inside the existing `dsh.workspace.view.v5` browser-store entry; a value stored before this change lacks the key and reads as no target, which the page handles like any other absent target. Stage accuracy for cold Sessions depends on the projection-cache rows the list already serves; a missing checkpoint can place a started Session under **Completed** until its summary refreshes with projection values. The `todos` list is the agent's own standing plan, so a Session that finishes its turn with an open list reads as **In progress** rather than lingering under **Working** — the distinction is deliberate: live activity versus declared remaining work. The page adds two type-only dependency edges, a main-slot entry, a sidebar panel row, and one page-local CSS module to `ui-workspace`, and emits no Cordis event.

## Verification

`tests/flow.client.spec.ts` covers stage precedence, blank Sessions, descendant activity, task figures, tie-break ordering, the outline-driven start-state split, and archive/subagent filtering. `tests/flow-page.client.spec.tsx` covers the empty target, per-stage columns and cards, the awaiting-user column, card navigation, returning to the Conversation, the workspace switcher and its dismissal, the missing-Workspace fallback, the blank-session card, the now bucket, and the panel glyph. `tests/workspace-browser.client.spec.tsx` covers the menu writing the target and selecting the page. `tests/apply.client.spec.ts` covers both registrations and the injected navigation callbacks. Package coverage for `ui-workspace` is 100% for statements, branches, functions, and lines.
