# Agent Note: Product navigation returns to the sidebar

Status: implemented

English | [中文](2026-10-22-product-navigation-in-sidebar.zh.md)

Supersedes [Product navigation moves above the conversation](2026-10-22-product-navigation-above-conversation.md).

## Problem

Moving the panel navigation into a bar above the conversation cost the center column 45px of height in every state, and it put the destinations in the reading surface rather than the column that lists what those destinations contain. The bar also carried a Conversation entry, which duplicated the sidebar's own New Session control and the workspace browser: the two were the same destination.

## Decision

`sidebar.navigation` is a single root-scoped slot, declared by `ui-layout` (the package `ui-sidebar` already depends on for `MainPanelId`) and rendered by `ui-sidebar` in a seat between the New Session control and the workspace section. `ui-layout`'s `ProductNavigation` occupies it: Knowledge, Workflow, Skill, Tool, the contributed `sidebar.navigation.panels` entries (the workspace Flow page), then Plugins, separated by a full-width rule.

The Conversation entry is gone — the sidebar's New Session control and workspace browser are the way back, so the row holds only panel destinations.

Every destination takes its own full-width row, matching the session rows below it and keeping all six reachable in a narrow column without a horizontal scroller; each keeps a tooltip that is enabled only when it is showing icons alone. The seat moves with the layout state rather than being duplicated: expanded it renders inside the content column with labels, and once a collapse settles it renders in the 56px rail as an icon column. While the collapse animates, the row stays in the frozen content column so the entries never straddle two layouts.

## Alternatives considered

**Keep the bar above the conversation and only drop the Conversation entry.** That still spends height on the reading surface for navigation that belongs to the sidebar's own listing.

**Keep two navigations, one per state.** Two seats for the same destinations means every panel feature registers twice, and the two halves can disagree about selection.

**Put the row above the brand.** The brand row is the column's identity; the navigation reads as a table of contents for what the column lists, which belongs next to the workspace section it precedes.

Selecting a panel now changes the center column alone. `AppFrame` used to collapse the sidebar whenever the active panel was not the conversation, and `ui-sidebar` used to hide the workspace browser on every other panel; both are gone, so the column the user navigates from never moves. `openSession` still selects the conversation panel, so clicking a Session returns the center column to it.

## Consequences

The sidebar's expanded content now opens with the navigation row, so the workspace header sits ~40px lower. Because the sidebar stays expanded on panel pages, the center column is 280px narrower than before on those pages; every shipped panel is a full-width page with its own header, so it reads as a two-column layout rather than a squeezed conversation. The collapsed rail gained the icon column and lost the duplicate panel list it used to render from `sidebar.panellist`; that list still powers the shell's fallback row when no package occupies the navigation seat. A deployment that replaces `sidebar.navigation` gets the row for both states and must render the compact form itself.

## Verification

- `packages/client/ui-sidebar/tests/sidebar-snapshot.client.spec.tsx` pins the seat in both states (content column expanded, rail collapsed).
- `packages/client/ui-sidebar/tests/panel-list.client.spec.tsx` keeps pinning the fallback list, including its absence when no panels are registered.
- `packages/client/ui-workspace/tests/apply.client.spec.ts` asserts the Flow entry lands in `sidebar.navigation.panels` and still selects `workspace-flow`.
- Verified live: the expanded row renders Knowledge/Workflow/Skill/Tool/Flow/Plugins above Workspaces with no Conversation entry in light and dark palettes, and the collapsed rail shows the six icons.
