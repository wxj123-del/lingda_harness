# Agent Note: Host-controlled workflow HTTP

Status: implemented

English | [中文](2026-09-23-workflow-host-http.zh.md)

## Problem

Visual HTTP nodes were represented as prompts for an agent, so a workflow could not perform a deterministic request, enforce transport policy, or return a bounded response directly.

## Decision

Add a host-owned `httpRequest()` guest binding and compile visual HTTP nodes to it. The host validates HTTP(S) URLs and methods, rejects private and non-allowlisted destinations, applies request/response byte and character caps, enforces a timeout, strips sensitive response headers, and resolves credential references only in the host process. Visual GET and HEAD nodes retry thrown request errors within their configured retry budget; non-idempotent methods remain single-shot. The VM still has no ambient `fetch`.

## Alternatives considered

**Retry every HTTP method:** Rejected because repeating POST, PUT, or PATCH can duplicate side effects without an idempotency key.

**Retry only inside the Host HTTP adapter:** Rejected because the visual node owns the retry budget and audit count; the compiler must keep retry behavior visible in the node execution record.

## Consequences

GET and non-GET visual HTTP nodes now return a structured response with status, bounded text, headers, truncation state, and optional JSON. Deployment configuration can narrow `httpAllowedHosts` and adjust resource caps. Request bodies and secrets do not enter progress logs. Safe-method retries are bounded and logged without response content; HTTP failures are fatal workflow errors after the final attempt, and cancellation aborts the host request.

## Validation

Workflow guest, host, and UI compiler tests pass, including credential redaction, allowlist/private-host rejection, request forwarding, and native HTTP compilation. Workflow PTC and UI Layout TypeScript checks pass.
