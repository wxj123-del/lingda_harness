# Agent Note: Local multi-library knowledge base

Status: implemented

English | [中文](2026-09-16-local-knowledge-base.zh.md)

## Problem

The authoring knowledge section stored plain text in `ui-authoring` and searched by substring. It could not isolate many libraries, choose a splitting strategy, or retrieve semantically related Chinese text.

## Decision

Add a Host-owned `knowledge` service. Its editable manifest uses optimistic revisions and atomic replacement. LanceDB stores one rotated table per committed index, so an index rebuild never exposes mixed revisions. `Xenova/bge-small-zh-v1.5` is loaded lazily through ONNX CPU inference. Recursive, Markdown, and fixed-length splitting share one preview and indexing implementation. The web panel manages libraries and documents, previews chunks, shows model/index state, and tests retrieval. `knowledge_list` and `knowledge_search` are the model-facing tools.

The web panel imports the previous `ui-authoring.knowledge` value once and leaves the source settings untouched. Search returns original excerpts, source identity, chunk ordinal, and cosine similarity; unfinished libraries are explicit in `skippedBases`.

## Consequences

Indexing and embedding are local and do not spend provider tokens, while tool definitions and retrieved excerpts add context tokens when a model request carries them. First use requires a network download. The data directory is intended for one active Host process. Chunk sizes are character based and the similarity score is not a calibrated probability.

## Verification

The knowledge package, Remote assembly, and layout package pass TypeScript project checks. Live Chrome verification on port 3081 covers two libraries, multiple Chinese documents, all three split previews, model download, LanceDB indexing, semantic search, reload persistence, and deletion. A 390px viewport has no horizontal overflow. Six split/UI tests and the knowledge Loader composition test pass, as does focused lint. The composition test replaces only external embedding inference and the chat provider; it records knowledge discovery, listing, source retrieval, and the source text reaching the next model request. Live chat submission was blocked by another Host holding the selected Session's write lease. The broader preset suite passed 36 tests before concurrent preset edits; its latest run has 35 passing and two failures in diaosi prompt/Skill expectations, outside the knowledge change.

The deletion Remote uses `deleteBase` to avoid the Client service's reserved `remove` method. Tools are registered only while an enabled library exists, and disappear after the last library is disabled or deleted.
