---
description: "Conversational authoring assistant that drafts visual workflows and private knowledge bases from a chat exchange."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-authoring-assistant

English | [中文](README.zh.md)

## Summary

This Host plugin provides `authoringAssistant`, a chat-driven drafting service for the web authoring surfaces. One conversation turn becomes one auxiliary model request that returns a structured workflow draft or knowledge-base draft. Drafting never appends a Session event: the browser decides whether to save the result through the existing workflow and knowledge Remotes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The web bundle mounts this package next to the workflow console and the knowledge panel. Two Remotes are exposed:

| Remote | Purpose |
|---|---|
| `generateWorkflow` | Turns one user message, prior turns, and the current draft into a validated workflow graph. |
| `generateKnowledge` | Turns one user message into a knowledge-base draft, optionally fetching source URLs first. |

Both Remotes resolve the model from the plugin config (`provider` and `model`), falling back to the deployment default model. Every turn carries its own cancellation signal. A model reply that contains no usable JSON still returns its prose so the conversation can continue.

`generateKnowledge` fetches at most eight absolute HTTP(S) URLs through `ctx.web`. Each page is reduced to plain text, clipped to 12,000 characters, and capped at 48,000 characters per turn. Fetched material is untrusted input: scripts, styles, and comments are stripped before the model sees it, and the prompt forbids fabricating a source URL or claim.

## Understand the implementation

`src/draft.ts` validates model output: it enforces one start and one end node, tool and HTTP node configuration, index bounds for edges, and deduplication. Edges that fail validation are dropped rather than failing the whole draft, so a mostly-correct proposal stays editable. `src/prompts.ts` owns the two system prompts and the bounded history and draft rendering. `src/text.ts` owns HTML-to-text extraction.

The service registers no model-facing tool and no prompt section. Draft structure reaches the browser only through the Remote result.

## Model Experience

### Workflow and knowledge drafting

#### What the model sees

Each `generateWorkflow` or `generateKnowledge` turn is one system prompt plus one user message holding the recent transcript, the current draft as JSON, any fetched source text, and the new request. The system prompt fixes the JSON shape and the graph rules; assistant turns are replayed as transcript text, never as tool results.

#### Token effect

Drafting charges provider tokens for the composed turn and the returned draft. History is bounded to the last twelve turns, fetched material to the configured character budget, and the request is rejected above 128 KiB. Embedding and indexing for a saved knowledge base run in the knowledge package, not here.

#### KV Cache effect

Every turn uses the same system prompt, so repeated drafting in one session reuses the prompt prefix. Editing the current draft changes only the user message.

## Known Limitations and Deferred Work

- **No retrieval during drafting** — the assistant drafts from the conversation and explicitly supplied URLs; it does not search the web by itself.
- **Draft only** — the service never saves, publishes, or indexes anything; a rejected or edited draft has no effect until the browser saves it.
- **Single provider route** — both Remotes use one configured or default model; per-draft model choice is not implemented.
- **No streaming** — the Remote returns the complete draft, so long generations show no token-by-token progress.

No runtime invariant companion is published; the service owns no durable state beyond the deployment default model it reads.

### Dev Note

Draft validation lives in this package because the model is untrusted input. Saving stays with the owning Remotes of `dsh-client-ui-layout` and `dsh-host-knowledge`, so this package never widens their persistence contracts.
