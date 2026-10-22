---
description: "Host-owned multi-library knowledge retrieval with editable documents, configurable text splitting, local Chinese embeddings, LanceDB persistence, and model-facing search tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-knowledge

English | [中文](README.zh.md)

## Summary

This Host plugin provides `knowledge`, a local multi-library knowledge capability. Library metadata, documents, revisions, and index manifests are stored under one data directory; chunk vectors are stored in LanceDB. The web authoring surface uses the `knowledge/*` Remotes, while agents use `knowledge_list` and `knowledge_search`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The web bundle mounts this package automatically. A library has a title, description, enablement, documents, and split settings. Saving starts a background index job. The UI can preview recursive, Markdown, or fixed-length chunks before saving and can run a search test that displays source excerpts and cosine similarity. Retrieval tools are registered while at least one library is enabled and removed when the last enabled library is disabled or deleted.

The default embedding model is `Xenova/bge-small-zh-v1.5`, loaded lazily through `@huggingface/transformers` with CPU ONNX inference. The first index or search downloads the model into the knowledge data directory. `dataDirectory` can be configured when settings are not file-backed; other model, size, batch, and limit fields are validated Host configuration.

## Understand the implementation

`src/index.ts` owns the manifest, optimistic revisions, atomic writes, stale-index rejection, background rebuilds, and LanceDB table rotation. `src/split.ts` owns preview/index parity. `src/embedding.ts` owns lazy model loading and retryable failures. `src/tools.ts` registers the agent tools. Each search applies a configurable cosine-similarity threshold, content deduplication, result-count limit, and estimated-token budget before returning the library, document, chunk ordinal, original excerpt, and similarity; incomplete indexes are reported in `skippedBases`.

The plugin imports legacy `ui-authoring.knowledge` records once when the web surface opens. The old settings section is preserved, and imported records are copied into the new manifest so migration does not rewrite the source document.

## Model Experience

### Automatic retrieval in conversations

#### What the model sees

The composer stores selected library ids in the current Session. Before the next user message reaches the model, the Host searches those libraries and adds attributed excerpts with the library, document, similarity, and index status. With no selection, no automatic search runs.

#### Token effect

Indexing and embedding run locally. Returned excerpts and the `knowledge_search` tool description consume context tokens only when they are included in a model request.

#### KV Cache effect

Selected-library context is appended through the existing request assembly, so changing the selection can change the reusable request prefix for later turns.

### Explicit knowledge tools

#### What the model sees

The model can call `knowledge_list` to inspect enabled libraries and `knowledge_search` to retrieve bounded source excerpts. The tools return library and document attribution instead of exposing local index paths.

#### Token effect

Tool schemas and returned excerpts consume provider context tokens. LanceDB lookup and embedding work stay local and do not consume provider completion tokens.

#### KV Cache effect

Explicit tool calls are ordinary appended tool turns and follow the existing request assembly and cache behavior.

## Known Limitations and Deferred Work

- **Local model download** — model files are downloaded on first use and require network access; failed downloads remain retryable and are shown in the model state.
- **Character-based limits** — split size and overlap are measured in characters, not tokenizer tokens. A future tokenizer-aware mode may make cost estimates more exact.
- **Local single-process ownership** — LanceDB is opened by the Host process and is intended for one active DSH process using a data directory at a time.
- **Per-Session selection** — the selection is recorded in the Session log so it can be reconstructed after resume and inherited by a fork; disabled libraries do not participate in automatic retrieval.

No runtime invariant companion is published because this package's durable contract is the knowledge manifest and indexed documents.

### Dev Note

The package is a Host service with Typert generated `./typert` and `./remote` faces. It is mounted by `dsh-web-app`; the Remote assembly is owned by `dsh-api-remotes`. Deletion uses `knowledge/deleteBase` because `remove` is reserved by the Client namespace service.
