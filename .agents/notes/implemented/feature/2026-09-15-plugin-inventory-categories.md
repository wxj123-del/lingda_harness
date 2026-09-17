# Agent Note: Plugin inventory browsing categories

Status: implemented

English | [中文](2026-09-15-plugin-inventory-categories.zh.md)

## Problem

The Plugin list tab rendered a long scope-grouped list. Search could find an exact term, but users had no useful way to browse related capabilities such as Skills, RAG, and common Tools.

## Decision

The client inventory page adds a category bar while retaining the existing Session plugins and Global plugins scopes. Categories are All, Skill & workflow support plugins, RAG & knowledge, Common tools, Agents & collaboration, Model-related plugins, System & sessions, Integrations, and Other plugins. Image-generation and voice-model plugins are included in the model-related category. The selected category combines with the existing search query.

The Plugins shell registers the `plugins` keyed `main` panel and retains the `settings.plugins.tab` extension point for its inventory and configuration tabs. Product navigation selects this page directly. Settings contains no Plugins section. The conversation browser hides on global pages while its width preference and session remain intact.

The classifier uses the module name and entry id already present in every inventory row. It checks integration terms first, then RAG terms, Skills and workflow terms, agent terms, model terms including image-generation and voice-model terms, tool terms, and system terms; unmatched rows go to Other plugins. The order keeps a specific `feishu`, `mcp`, `rag`, image-generation, or voice-model plugin from being swallowed by a generic `tool` match and requires no Remote schema change for custom plugins.

The separate Tools main page presents cards with descriptions and cumulative calls through `pluginInventory/toolUsage`; the Plugins page contains no usage tab. Details show recorded parameters and usage, while user-authored tools retain their editor and join counts by registered name. Keeping tools beside their usage distinguishes callable capabilities from the plugins that provide them. The reader groups live and saved Session calls by name, excludes inherited fork history, and counts each PTC dispatch once without persisting a second counter. Unused recorded schemas remain visible with zero calls; failed reads produce partial counts. The Host README owns the counting rules.

## Alternatives considered

**Add a category field to the Host inventory Remote.** Rejected for this browsing improvement because existing custom plugins do not publish category metadata, and changing the shared snapshot would require every producer and consumer to migrate together. The current identifiers already provide enough stable information for a useful first grouping.

**Replace Session plugins and Global plugins with categories.** Rejected because scope and capability answer different questions. The UI keeps both scope sections and applies categories inside them.

**Use only free-text search.** Rejected because users need to discover broad capabilities before they know a module name, especially with large custom plugin sets.

## Consequences

- Category counts reflect the selected preset rows plus global rows and update with search.
- Custom identifiers containing terms such as `feishu`, `lark`, `mcp`, `rag`, `embedding`, and `knowledge` are placed into useful groups without package changes.
- Classification remains a presentation heuristic. A future plugin metadata contract can replace or refine it without changing the category filter interaction.
- Categories wrap on narrow screens. The inventory contains plugin modules only; actual Skills, workflows, tools, and knowledge bases remain in their respective pages. Removing duplicate cards changes neither storage nor runtime registrations.
- The standalone page uses the main content width and responsive card grid instead of the Settings modal's narrow content column.
- Tool usage is refreshed explicitly and costs no model Tokens. Recorded-session browser coverage pins cross-session totals, unused tools, filtering, refresh, and narrow-screen layout; unit coverage pins fork and PTC deduplication and partial reads.
