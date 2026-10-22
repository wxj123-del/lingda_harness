# Agent Note: Product navigation moves above the conversation

Status: implemented

English | [中文](2026-10-22-product-navigation-above-conversation.zh.md)

## Problem

The product navigation — Conversation, Knowledge, Workflow, Skill, Tool, Plugins — lived in its own 56px column inside the sidebar, always drawn beside the column's content. That column spent the product's scarcest horizontal space on icons while the conversation, which the user is reading, got less width; the sidebar also had to reserve room for the rail in every state, so its content started 56px to the right of the panel edge.

## Decision

`ui-layout` declares `shell.navigation`, a single root-scoped slot, and `AppFrame` renders it as the first child of the center column, above the selected main panel. The bar spans the conversation's width, not the sidebar's, and it sits outside the panel seat so switching panels never moves it. `ui-layout`'s own `ProductNavigation` register occupies it with one horizontal row of icon+label cells; the label lives in the cell instead of a hover tooltip, because the bar is as wide as the conversation.

A feature panel joins that bar through `shell.navigation.panels`, a list declared as a child of `shell.navigation`: one entry per main-slot key, with the same `id`/`order`/`label` metadata `sidebar.panellist` takes and an icon component receiving `{ size, active }`. `ui-workspace` moves its Flow page entry there, so the Flow page keeps its navigation entry without occupying sidebar rows.

The interior rail is gone: `ui-sidebar` no longer declares or renders `sidebar.navigation`. The sidebar column keeps the brand row, New Session, the remaining global panel entries (`sidebar.panellist`), the workspace browser, and the foot; the collapsed 56px rail still renders the expand toggle and those panel entries. Both the wide list and the rail's icons therefore remain reachable, and no surface lost its entry.

## Alternatives considered

**Move the whole sidebar above the conversation.** The sidebar's value is the session list, which needs vertical room and a persistent column; a horizontal top bar would have to invent a dropdown or horizontal scroller for the same content and would change the browsing model, not just the navigation's position.

**Keep the rail and add the horizontal bar.** Two navigations for the same destinations in one shell: one of them would always be redundant, and the rail's icons would keep consuming column width.

**Put the horizontal bar inside the sidebar's content.** That keeps the bar in the column it navigates away from, so it would disappear whenever the sidebar collapses to the rail — the product navigation would be unreachable exactly when the user has hidden the browsing column.

Superseded by [Product navigation returns to the sidebar](2026-10-22-product-navigation-in-sidebar.md): the row moved into the sidebar above the workspace section and lost its Conversation entry.

## Consequences

The bar takes 45px of vertical room from the center column in both states, including the blank New Session hero, which now centers in the space below it. A narrow window keeps the bar above the collapsed rail rather than in it, so its labels stay readable. `shell.navigation` is additive for deployments: registering into it replaces the shipped bar, and registering into `sidebar.panellist` still adds a panel entry to the sidebar.

## Verification

- `packages/client/ui-layout/tests/app-frame.client.spec.tsx` asserts the bar leads the center column, precedes the panel inside it, and stays out of the sidebar column.
- `packages/client/ui-layout/tests/apply.client.spec.ts` pins the declared root slots, including `shell.navigation`.
- `packages/client/ui-workspace/tests/apply.client.spec.ts` asserts the Flow page entry lands in `shell.navigation.panels` and still selects `workspace-flow` as its main key.
- `packages/client/ui-sidebar/tests/sidebar-snapshot.client.spec.tsx` snapshots the sidebar without the interior rail in both states.
- `packages/client/ui-sidebar/tests/panel-list.client.spec.tsx` keeps pinning the global panel entries in the wide list and the collapsed rail.
