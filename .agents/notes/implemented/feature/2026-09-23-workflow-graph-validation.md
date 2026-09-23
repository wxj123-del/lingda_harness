# Agent Note: Shared visual workflow graph validation

Status: implemented

English | [中文](2026-09-23-workflow-graph-validation.zh.md)

## Problem

The visual editor and compiler each validated the same graph independently. A graph could appear valid in the editor but fail to compile later, especially around HTTP configuration, credentials, retries, identifiers, duplicate edges, and graph reachability.

## Decision

Add `analyzeWorkflowGraph()` as the shared structural validator and graph index builder. The editor maps its stable issue codes to localized validation messages, while the compiler refuses any graph with an issue and consumes the same adjacency maps and topological order. Validation covers node and edge limits, identifiers, required node configuration, HTTP methods and URLs, credential references, retry bounds, terminal counts, edge references, duplicate edges, branch handles, reachability, dead ends, duplicate condition branches, and cycles.

## Consequences

Publish and direct test runs now report the same graph contract that compilation enforces. Invalid or ambiguous graphs fail before any model, tool, or HTTP side effect starts. The compiler retains its existing dependency-wave execution after validation succeeds.

## Validation

Shared validator tests cover valid graphs, strict HTTP/credential/retry/id checks, duplicate edges, cycles, and disconnected nodes. UI Layout tests and TypeScript checks pass.
