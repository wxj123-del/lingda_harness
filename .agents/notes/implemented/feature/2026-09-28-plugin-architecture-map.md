# Agent Note: Plugin architecture map

Status: implemented

English | [中文](2026-09-28-plugin-architecture-map.zh.md)

## Problem

The plugin inventory exposed module rows and category filters, but it gave no visual overview of how the loaded capabilities fit together. Users had to scan cards before understanding the composition at a glance.

## Decision

The inventory page now renders a read-only, puzzle-like capability map above the detailed cards. It contains eight stable nodes — Model, Skill, Tools, Session, Sandbox, Agent Loop, UI, and Storage — with localized labels, familiar primitive icons, unique-module counts, and version markers that mirror the visual language of the supplied reference. Counts derive from the same Host snapshot and the currently selected agent preset. Selecting a node applies its existing category filter; no new Remote data or runtime dependency graph is introduced.

The node classifier intentionally remains a presentation heuristic. It reuses the existing category classifier for broad groups and explicit identifier terms for Session, Sandbox, UI, and Storage, so custom modules remain discoverable without changing Host payloads.

## Alternatives considered

Adding a second dependency-graph Remote was rejected because it would duplicate Host composition data. Replacing the searchable inventory with a diagram was rejected because operators still need exact module rows and filters.

## Consequences

The Plugins page has an at-a-glance capability view while retaining the existing searchable, expandable inventory. The map may show zero for a conceptual node when the current snapshot has no matching module, and its labels do not imply that the listed modules are direct runtime dependencies.

## Validation

Plugin inventory component and browser-plugin tests pass (19 tests). The package TypeScript project and client bundle build pass.
