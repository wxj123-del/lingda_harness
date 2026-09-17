---
description: "Shell layout for the Web GUI: the three-column AppFrame whose right column is a track for an edge-anchored panel, the panel-geometry service, and theme presentation; for users and maintainers of the window chrome."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

## Summary

This package provides the Web GUI's three-column AppFrame, edge-column widths, and `ctx.layout` presentation control. It also provides authoring surfaces for Skills, workflows, tools, and knowledge libraries. The [knowledge Host](../../host/knowledge/README.md) stores documents and vectors independently of UI settings. The right column concedes space before the center; its occupant renders fullscreen while the frame retains the wide-screen track underneath. The theme presenter owns color scheme, alias tokens, content font size, and document metadata. Layout state resets on reload.

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

The root slot composes the sidebar, main content, and right column. The sidebar spans 264–420px, defaults to 280px, and retains a 56px rail when collapsed; below 1024px it collapses automatically, and opening the right panel collapses a manually expanded sidebar. The right panel first opens at 45% of the viewport, then retains the user's pixel preference, capped at 70%. To protect 400px for the center, the frame first reduces the right panel to 300px, then reports insufficient room so its occupant closes it, and only then compresses the center further. Dragging has no transition delay; the right handle is absent while closed or fullscreen.

Global panels occupy the root-scoped `main` keyed slot; `conversation` is the reserved key for the Conversation. `ctx.layout.selectPanel(id)` selects a registered panel, and `null` selects the Conversation without changing the current Session. The authoring pages register their own global panel keys.

### Theme presentation

The presenter consumes resolved theme snapshots and projects them onto the document: `html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens and `--dsh-content-font-size` as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background. Disposing the presenter removes its metadata node with its other global writes.

### Tool catalog

The metrics band shows settled requests, tool exposures, hits and aggregate hit rate across the retained corpus, independent of search and filters. Cards show each tool's exposures and hit rate; details add the hit count. Exposure and ascending hit-rate sorts help find frequently carried tools with few calls. A dash means no measured exposure, while missing catalogs have a separate coverage notice. These metrics are read-only and do not change tool selection.

Select **Tools** in the navigation rail to browse one card per recorded or user-authored tool. Cards show the name, description, cumulative calls, and most recent call. Filters separate called, unused, and custom tools; search covers names and descriptions, and sorting supports usage or tool name. Details show the full description, recorded parameter schema, direct and internal call counts, and involved Sessions. Custom tools retain creation and editing, with saved instructions and steps; their usage joins the registered name rather than the display title.

Known tools use locale-owned descriptions in cards and details, with the recorded original available in a disclosure. Search matches both localized and original descriptions. Custom and unrecognized tools retain their supplied descriptions. Display translations neither invoke a model nor change model-facing tool definitions.

Refresh reads `pluginInventory/toolUsage` without a model request. Failed reads have an error state, unreadable Sessions produce a partial-count warning, and unmount cancels pending reads. The [Host reader](../../host/plugin-inventory/README.md#tool-usage) owns the cross-session counting rules. The Plugins page contains no tool-usage tab.

### User-authored plugins

The authoring navigation stores Skills, workflows, and tools in the `ui-authoring` settings namespace. The knowledge editor uses the `knowledge` Remote and imports legacy settings once. Each library has independent documents, enablement, and recursive, Markdown, or fixed-length split settings. The editor accepts manual text and local UTF-8 files (`txt`, Markdown, JSON, CSV, and YAML), previews chunks, shows indexing failures and retry controls, and tests retrieval against the saved index. Unsaved changes disable retrieval tests.

The Skill marketplace combines the built-in Create Skill (`make-skill`) and Create Workflow (`make-workflow`) instructions with saved user Skills. Source filters, category counts and search operate together; older Skills without a category appear under General. Details display the full instructions and ordered steps, while custom entries retain an editor and enabled state. Use in chat prefixes the exact `/name` invocation to the current composer draft, preserving existing text without sending it; when no Session is selected it creates one first. Built-in content and runtime registration share the same catalog. This is a local catalog, without an external marketplace or download service.

Upload Skill accepts one ZIP containing exactly one `SKILL.md`, at the root or inside a folder. YAML frontmatter must declare a lowercase hyphenated `name` and a non-empty `description`, followed by non-empty instructions. A preview allows editing the recognized fields and category before confirmation; importing the same name updates that record after confirmation. Existing entries remain editable. The original ZIP preserves scripts, references and assets. Limits are 2 MiB compressed, 8 MiB expanded and 256 entries; invalid metadata, multiple Skills, duplicate paths and path traversal are rejected. Uploading never executes bundled scripts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`selectPanel(id)` checks the live `main` registry before changing selection; an absent key throws and leaves the current panel intact. `beginNavigation()` returns an abort signal for an asynchronous UI navigation. A later call, a valid panel selection (including repeated selection), or layout disposal aborts that signal without cancelling underlying Session creation. Consumers check the signal before committing navigation or moving drafts.

One registration declares four child slots and binds `ctx.layout` methods `selectPanel`, `toggleSidebar`, `openRightbar(track, fullscreen)`, and `closeRightbar`. One root store separates `panelInfo` selection from `layoutInfo` measurements, width preferences, and presentation reports. `usePanelInfo` subscribes to the stable selection object; AppFrame subscribes to the stable layout object. The `rightbar` owner supplies actual `width`, `viewportWidth`, and normal-presentation eligibility `canShow`; insufficient room causes a deterministic close, never automatic reopening on widening. Fullscreen hides the width handle without releasing a track the occupant retains. AppFrame keeps the column containers mounted. The right column's root controller renders `rightbar.session` through `SessionProvider` only while the Conversation is selected; its unmount report releases the track. The independent title component uses the selected Session title only while the Conversation is visible, with the build-configured product title or localized `common.brand.localBuild` as its fallback; locale revisions update that fallback. The theme presenter is a second effect: pure DOM writes from resolved snapshots — initial state through the getter once, then event-driven only, with no React path. It applies palette, font-size, and token variables before measuring the rendered background as the single color authority. Fullscreen presentation suppresses grid and handle transitions; its occupant reports the new columns only after covering the frame. Fullscreen exit keeps transitions suppressed while the frame installs its destination geometry: close removes the right track, and restore retains it. Subsequent normal geometry actions restore ordinary transitions.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the layout surface is not enough. They move from the frame to the columns it renders and the theme it presents.

- [ui-sidebar](../ui-sidebar/README.md) — occupies the `sidebar` column and its seats.
- [ui-conversation](../ui-conversation/README.md) — occupies the `main` key `conversation`.
- [ui-sidebar-right](../ui-sidebar-right/README.md) — occupies the `rightbar` column with one docking surface per session.
- [ui-theme](../ui-theme/README.md) — the theme seam whose resolved snapshots the presenter consumes.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

The Host registers two built-in authoring Skills and enabled user Skills. Names and descriptions enter the Skill catalog through `tool-skill`; full instructions are loaded on demand or by explicit `/name` invocation. User descriptions include their display title so natural-language references can match it. The built-ins produce reusable editor content and do not claim to save or execute it. User workflows and tools return instructions; the knowledge Host owns semantic retrieval and its tools.

Imported Skills retain `disable-model-invocation` and `user-invocable`. On first load, the Host validates the stored archive again and materializes its resources beside the settings document, normally under `$DSH_HOME/skill-imports/<sha256>`, exposed as the Skill's resource directory. Non-file settings providers use a process-specific temporary cache. Only metadata enters the catalog; attachments are not injected automatically. Create Skill produces upload-compatible `SKILL.md` content and may package it when file tools are available.

#### KV Cache effect

Browsing and editing do not send provider requests. Registered Skill summaries consume catalog context, and loaded instructions consume conversation context; changing a title or description can update the catalog. Categories are presentation metadata and do not enter model instructions.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current layout behavior. They are current package constraints, not a general window-manager comparison or a task backlog.

- **Panel geometry is transient** — reload restores the sidebar default and the right panel hidden; each dragged width is one frame-wide preference, not a per-Session fact.
- **Extremely narrow windows** — after the right panel closes, the center may still fall below 400px; the left 56px rail remains.
- **Track and panel travel on one shared curve** — the frame's track transition and the occupant's slide read the same duration and easing variables; an occupant that used its own would detach the panel's edge from the conversation's while squeezing.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
- **Imported resources are local to the Host** — a remote or sandbox filesystem must have access to that directory before it can read attachments. ZIP import does not install dependencies, execute scripts, or remove cached resources when an entry is disabled.
- **Tool usage follows retained logs** — new calls appear after refresh. Recorded descriptions and schemas use the newest available request header, not a live capability probe; tools absent from history and saved custom entries have no card. A historical card does not guarantee availability in the currently selected preset.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The shell viewing-state store behind `ctx.layout` emits no Cordis events; clamp and track sequencing is asserted directly by this package's columns and service specs.
