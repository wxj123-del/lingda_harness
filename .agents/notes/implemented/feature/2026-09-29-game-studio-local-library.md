# Agent Note: Local Game Studio source library

Status: implemented

English | [中文](2026-09-29-game-studio-local-library.zh.md)

## Problem

The Game Studio preset knew about one canonical editor Demo and project-local run records, but it could not retrieve the operator's existing editor projects, playable builds, or material folders without copying or executing those sources.

## Decision

`import-local-library.mjs` scans explicitly selected local roots and writes a compact `.game-studio/library.json` manifest containing provenance, revisions, entrypoints, capabilities, asset counts, and bounded evidence paths. `studio_library` validates and retrieves that manifest during SCAN, while all source folders remain read-only and outside the model execution loop.

The manifest is metadata, not model training or source ingestion: it avoids copying binary assets, does not run discovered code, and returns bounded results. A missing manifest is an explicit empty state, so projects opt in by generating one and keeping it in their workspace.

## Alternatives considered

Copying or executing discovered project sources was rejected because the library is for context and provenance, not runtime execution. A hosted project index was rejected because local paths and assets should remain on the operator's machine.

## Consequences

The preset can use the user's local editor and playable history as searchable production context while keeping source provenance visible and execution isolated. The manifest must be regenerated when projects or materials change, and absolute source paths are intentionally local metadata rather than portable project configuration.
