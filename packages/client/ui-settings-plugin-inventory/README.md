---
description: "Read-only plugin module inventory for the dsh web client, grouped by agent preset and global scope with category filters and search."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

## Summary

The **Plugins** page lets Web users inspect plugin modules in agent presets and global entries without changing configuration. Category filters and search narrow the inventory; cards show enablement and runtime details. Actual Skills, workflows, tools, and knowledge bases stay in their respective navigation pages and do not contribute duplicate inventory cards or counts. Reading these views makes no model request.

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

Select **Plugins** in the product navigation to inspect the Host's plugin inventory. The page reads no Remote during plugin activation — opening it for the first time mounts the component and lazily calls `ctx.remote.pluginInventory.list()` through `api-remotes`.

### Reading a card

Each collapsed card uses the short module name as its primary title, shows the stable entry id underneath, and carries a small enablement tag; enabled entries also show a colored root-fiber status dot. A composition-generated subtitle omits its leading `include:` marker, while hover, search, the accessible name, and expanded details retain the complete id. Long entry ids truncate in the row and remain available on hover. Expanding one card reveals the declared entry id, the full module specifier, and the state facts: a preset row names the preset it comes from, its runtime status when the composition is live, and its disable condition when it carries one; a preset-provided global row explains that agent presets provide it per session, names the presets that enable it, and offers a jump into the preset group. Preset names resolve through the shared `presetDisplayText` fold (`dsh-agent-presets/display`) over [`ui-agent-preset`](../ui-agent-preset/README.md)'s dictionaries: shipped presets follow the active locale while user-authored ones keep their own metadata, so an English surface never echoes the preset files' Chinese names. Search filters both groups by module name and entry id.

### Categories and the preset switcher

**Skill & workflow support plugins** groups the modules that load Skills, invoke them, and support workflow execution. It is not a list of available Skills; imported and user-authored Skills are managed in the [Skill marketplace](../ui-layout/README.md), without moving or duplicating their stored content.

The category bar is a browsing filter, not an enablement scope. It keeps the existing **Session plugins** and **Global plugins** sections intact, and the count on each category reflects the currently inspected preset plus the global rows. The classifier checks explicit identifier terms in a fixed order: external integrations and RAG terms take precedence over generic tool terms, model terms include image-generation and voice-model identifiers, and unmatched rows go to **Other plugins**. This makes a custom `feishu`, `lark`, `mcp`, `rag`, `embedding`, `knowledge`, `image-generation`, or `tts` plugin discoverable without requiring a package registration change. Search and categories can be used together.

The preset switcher

The switcher is the same selector-pill-plus-menu control the General settings rows use. It lists every roster preset — the default suffixed as such, broken ones marked — and changes only what the list shows: it writes no settings, and selecting a broken preset shows the discovery-reported reason in place of rows. Choosing the default preset or a session's preset stays where it was: the Agent presets section and the new-session screen.

### Retrying a failed read

A failed read renders a generic failure state inside the tab; retrying re-runs the lazy `list()` call without exposing transport details.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tab is a read-only projection of a Host-owned snapshot; it performs no Remote read during plugin activation and takes the snapshot on first selection.

### Registration

The browser plugin registers the inventory `settings.plugins.tab` contribution inside the independent Plugins main page owned by `ui-settings-plugins`. This extension point retains its name for existing contributors; it has no dependency on the Settings modal. Registration uses `ctx.slots.inject()` to follow declaration, redeclaration, and teardown; the renderer supplies locale updates.

### Rendering

Row keys are scope-qualified (`global:`, `preset:<id>:<index>`), so one module appearing in both scopes keeps distinct disclosure state; a declared entry id appears in expanded details and supplies the collapsed subtitle after removal of a leading composition `include:` marker, while a row without one stays unlabeled. The preset-provided marking is derived client-side: a global entry carries it when it is disabled there while at least one preset row for the same module specifier is actually enabled, so a module every preset gates off (or declares only conditionally) stays plainly disabled rather than over-claiming provision.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the main page, remote call, and Host-side projection.

- [ui-settings-plugins](../ui-settings-plugins/README.md) — the independent Plugins page and tab owner.

- [api-remotes](../../api/remotes/README.md) — the Remote BFF surface behind `pluginInventory.list()`.
- [plugin-inventory](../../host/plugin-inventory/README.md) — the Host-side read-only Loader projection this tab renders.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side inventory projection that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the freshness and reach of the inventory view; they are current package constraints.

- **One snapshot per Settings mount or retry** — the tab does not subscribe to Loader changes or automatically refetch after reconnect; switching tabs preserves the current snapshot, while reopening Settings obtains a new one.
- **Read-only in both planes** — the tab shows global and preset enablement but mutates neither; enable/disable controls that write a custom preset's own composition file are deliberate follow-up work.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package owns a read-only Settings contribution.
