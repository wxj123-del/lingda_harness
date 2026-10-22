# Agent Note: Built-in authoring catalogs and workflow console

Status: implemented

English | [中文](2026-09-22-authoring-catalogs-and-workflow-console.zh.md)

## Problem

The Skill page exposed built-in instructions but required users to recreate them manually. Workflows used the generic authoring editor, so users had no template discovery, import path, or focused place to maintain ordered workflow steps.

## Decision

Keep built-in content as typed, locale-owned templates and persist an imported copy in the existing `ui-authoring` settings namespace. The Skill catalog offers one-click import for built-ins and uses stable ids to avoid duplicate cards while preserving later edits. The workflow page uses a dedicated template-library console with search, source filters, three deterministic test templates, one-click import, and a visual editor. The editor stores positioned nodes and directed edges, supports dragging, palette insertion, connection handles, enablement, and a property inspector. It derives the legacy ordered instruction list from the graph so existing runtime tools remain compatible, and provides a launch action that opens the composer with the registered workflow tool name.

The runtime continues to register enabled user workflows as instruction tools. The client does not call the Host-only workflow engine directly; launching a workflow composes a model-visible request into the existing conversation input, keeping execution and session logging in the established tool path.

## Alternatives considered

**Keep the generic editor.** Rejected because it hides reusable examples and requires users to know the persisted data model before creating a workflow.

**Run the workflow engine from the browser.** Rejected because the engine is Host-owned and direct browser access would duplicate execution and lifecycle policy.

**Treat imported templates as read-only cards.** Rejected because users need to adapt test workflows to local instructions and constraints.

## Consequences

Built-in Skill and workflow content now has a discoverable import path and stable persistence. Imported templates can be edited without changing the bundled defaults. The console is local and does not fetch a remote marketplace; adding future templates requires adding localized template definitions and their runtime-facing content. UI behavior is covered by client component tests, and the package documentation records the template/import/editor model.
