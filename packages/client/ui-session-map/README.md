---
description: "Session map view for the dsh web client: the viewed Session's turns as one spine, with every fork hanging off the turn it branched from."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-map

English | [中文](README.zh.md)

## Summary

The **Map** tab draws the viewed Session as a single vertical spine of turns. Each completed turn is one card carrying its bounded prompt and final-response previews, and every Session forked from that turn appears as a branch chip directly beneath it. A **Branch from here** control on each card forks the conversation at that turn, so exploring an alternative continuation does not require finding the same point again in the transcript.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open the **Map** tab in the conversation's view ring. The header states how many turns and branches the map holds; below it, the spine lists every turn in ascending order.

Each card shows the turn number, its prompt preview, and its final-response preview. A turn whose prompt preview is empty — an assistant-only turn, or a turn whose opening message carried no text — says so rather than rendering a blank line.

### Branching

**Branch from here** forks the conversation immediately after that turn. The fork uses the same Session controller verb the chat's own turn action uses (`fork({ atSeq, increaseTitle: true })`), so a branch created from the map behaves exactly like one created from the chat: it inherits the source prefix, gets an incremented title, attaches to the same Workspace, and stays closed until opened. Forking is blocked while the Session runs, and every card's control is disabled while one fork is in flight. A failed fork reports the reason above the spine and leaves the control retryable.

### Branches

A branch chip shows the child's title, how many turns it holds, and a running marker when it is live. Selecting a chip opens that Session, which swaps the whole conversation — including this tab's content — to the branch. The map always describes the Session currently on screen.

Branches whose own turn outline is unavailable cannot be placed against a source turn; they are listed in a separate section that states why, rather than being guessed onto the nearest row. Subagent-origin children never appear as branches, matching the browser's own list.

-----

<a id="understand-the-implementation"></a>
## Understand this package

<details>
<summary>Implementation internals — click to expand</summary>

`buildSessionMap` (`src/client/map.ts`) is pure over wire values. It narrows the `turnOutline` projection with the same damage rules the chat rail applies — a turn without a usable `turn` or `seq` drops out, while previews degrade to empty strings — and then places children by their **inherited turn count**: a fork copies the source's prefix, so a child's outline length names the parent turn it branched after. A child with no outline of its own is reported unattached.

The View reads three framework sources and nothing else: `useSession` for the running gate, `useProjection('turnOutline')` for the spine, and `useSessions` for fork lineage (`parentId` plus each child's outline length). It issues no Host request and holds no durable state; the only local state is the in-flight fork flag and the last error.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-conversation](../ui-conversation/README.md) — the view ring this tab joins and the Session shell around it.
- [ui-trajectory](../ui-trajectory/README.md) — the neighbouring ledger view over the same turns.
- [Session Controller](../../api/session-controller/README.md) — owns `fork`, the list snapshot, and projection delivery.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No canvas layout** — the map is a vertical spine rather than a free-form graph. Branch chips are indented under their source turn; there is no pan, zoom, dragging, or per-Session layout persistence.
- **Only direct forks are shown** — a branch of a branch appears when that branch is the viewed Session; the map does not walk the whole tree at once.
- **Fork placement depends on projection data** — a branch created in this process whose outline has not yet been projected is listed as unattached until its summary refreshes.
- **The tab requires the view ring** — with "Show session view tabs" turned off in Settings, no view tab renders, this one included.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The map deliberately does not fork itself: `forkAt` reaches the list service that the chat's turn action also uses. Keeping one fork verb means the two entry points cannot drift in what they inherit or how they name the child.

</details>

**Runtime invariant:** No companion is published. The package registers one Conversation View entry and its dictionaries; it provides no service and owns no cross-plugin mutable state.
