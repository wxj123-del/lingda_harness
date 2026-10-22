---
description: "The right-Sidebar source-control tab: branch state, staged and unstaged change groups, staging actions, commit, and pull over the gitWorkspace Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-repository

English | [中文](README.zh.md)

## Summary

This package adds a repository tab to the Web GUI's right Sidebar. It shows the current branch, ahead/behind counts, staged and unstaged change groups, and recent history, and it offers stage, unstage, commit, and pull. Every operation goes through the `gitWorkspace` Remote namespace, so the browser never reads the checkout directly; each mutation writes back the snapshot the Host read after it, keeping rows and counters consistent. The package contributes nothing to the Host tree.

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

Mount the plugin in a Web composition that also loads the `gitWorkspace` Remote face. The tab then appears as a right-Sidebar type named `repository`; opening it resolves the repository for the current Session's workspace and renders the panel.

### What the panel shows

The branch line names the checkout and its upstream with ahead/behind counts. Below it, staged and unstaged changes are grouped by kind, and recent history lists commits. A pending operation disables the actions that would race it.

### Actions

Stage and unstage move one file between groups; commit takes a message; pull fetches and merges. Each action is a Remote call, and its result replaces the store's snapshot rather than being merged optimistically, so a concurrent Host-side change cannot leave the panel showing stale groups.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package splits a pure state view from an asynchronous face. `state-view.ts` derives the rendered rows and groups from a snapshot; `face.ts` performs the Remote calls and writes outcomes through the store's own actions. The component never awaits: it calls injected callbacks, which keeps every write in the store where the framework can observe it.

The tab registers through the two-stage public path — the type into `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat and the chip title into `sidebar.right.pane.tab.title`, both under the type's id — and binds its copy under the `sidebarRepository` namespace.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host half; intentionally empty |
| [`src/client/index.ts`](src/client/index.ts) | Registers the tab type, dictionaries, body seat, and title seat |
| [`src/client/face.ts`](src/client/face.ts) | Remote calls, cancellation, and snapshot write-back |
| [`src/client/state-view.ts`](src/client/state-view.ts) | Pure row and group derivation |
| [`src/client/store.ts`](src/client/store.ts) | Tab-scoped state and pending actions |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Client group map](../README.md) — the browser-side package family and its slot conventions.
- [Sidebar right](../ui-sidebar-right/README.md) — the tab registry and keyed seats this package registers into.
- [git workspace](../../interaction/git-workspace/README.md) — the Host-side Remote namespace the panel calls.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers a browser-only Sidebar tab and contributes no tool, prompt, or Session event.

#### KV Cache effect

Does not invalidate: nothing in this package reaches request assembly.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One repository per Session workspace** — a Session without a workspace path shows no repository, and multi-repository workspaces are not modeled.
- **No diff viewer** — the panel lists changed files; opening a diff belongs to the document-preview surface.
- **No conflict resolution** — a pull that conflicts surfaces the failure and leaves resolution to the user outside the harness.
- **Host half is empty** — the tab is purely browser-side; anything needing Host work belongs in `git-workspace`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is explicitly non-authoritative.

</details>
