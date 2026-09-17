---
description: "Host-owned multi-library knowledge retrieval with editable documents, configurable text splitting, local Chinese embeddings, LanceDB persistence, and model-facing search tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-knowledge

English | [中文](README.zh.md)

## Summary

This Host plugin provides `knowledge`, a local multi-library knowledge capability. Library metadata, documents, revisions, and index manifests are stored under one data directory; chunk vectors are stored in LanceDB. The web authoring surface uses the `knowledge/*` Remotes, while agents use `knowledge_list` and `knowledge_search`.

## Use this package

The web bundle mounts this package automatically. A library has a title, description, enablement, documents, and split settings. Saving starts a background index job. The UI can preview recursive, Markdown, or fixed-length chunks before saving and can run a search test that displays source excerpts and cosine similarity. Retrieval tools are registered while at least one library is enabled and removed when the last enabled library is disabled or deleted.

The default embedding model is `Xenova/bge-small-zh-v1.5`, loaded lazily through `@huggingface/transformers` with CPU ONNX inference. The first index or search downloads the model into the knowledge data directory. `dataDirectory` can be configured when settings are not file-backed; other model, size, batch, and limit fields are validated Host configuration.

## Understand the implementation

`src/index.ts` owns the manifest, optimistic revisions, atomic writes, stale-index rejection, background rebuilds, and LanceDB table rotation. `src/split.ts` owns preview/index parity. `src/embedding.ts` owns lazy model loading and retryable failures. `src/tools.ts` registers the agent tools. Each successful search returns the library, document, chunk ordinal, original excerpt, and cosine similarity; incomplete indexes are reported in `skippedBases`.

The plugin imports legacy `ui-authoring.knowledge` records once when the web surface opens. The old settings section is preserved, and imported records are copied into the new manifest so migration does not rewrite the source document.

## Model Experience

`knowledge_list` and `knowledge_search` are model-visible tools. Search results add retrieved source text to the next model context only when the agent calls the search tool. Indexing and embedding happen locally and do not consume provider tokens. Tool descriptions and returned excerpts do consume context tokens when sent to a model.

#### KV Cache effect

The plugin does not change the model cache policy. A search result is ordinary tool output and follows the existing request assembly and cache behavior.

## Known Limitations and Deferred Work

- **Local model download** — model files are downloaded on first use and require network access; failed downloads remain retryable and are shown in the model state.
- **Character-based limits** — split size and overlap are measured in characters, not tokenizer tokens. A future tokenizer-aware mode may make cost estimates more exact.
- **Local single-process ownership** — LanceDB is opened by the Host process and is intended for one active DSH process using a data directory at a time.
- **No automatic refresh subscription** — the Client refreshes the overview while the panel is open; other clients must request a new overview.

## Dev Note

The package is a Host service with Typert generated `./typert` and `./remote` faces. It is mounted by `dsh-web-app`; the Remote assembly is owned by `dsh-api-remotes`. Deletion uses `knowledge/deleteBase` because `remove` is reserved by the Client namespace service.
