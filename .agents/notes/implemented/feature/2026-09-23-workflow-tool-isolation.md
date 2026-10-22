# Agent Note: Workflow tool isolation

Status: implemented

English | [中文](2026-09-23-workflow-tool-isolation.zh.md)

## Problem

Visual `tool` nodes were rendered as ordinary model prompts. A child could see unrelated tools, so the graph's configured tool was descriptive rather than an enforceable capability boundary.

## Decision

Add a validated `toolFilter` option to workflow `agent()` calls and carry it through the PTC guest, generated guest source, Host callback boundary, and Subagent start request. The visual compiler emits `{ allow: [configuredTool] }` for every tool node and rejects a tool node without a configured tool. The child provider remains responsible for validating that the named tool exists and for enforcing the restriction as both prompt visibility and execution authority.

## Alternatives considered

Relying on prompt wording alone was rejected because visibility is not execution authority. Granting the full global catalog to every child was rejected because it violates the configured tool boundary.

## Consequences

Tool nodes now run with least-privilege tool visibility and cannot accidentally expose the rest of the global tool catalog to their child agent. Provider capability and unknown-tool failures are surfaced as workflow errors. This is a constrained native tool route; HTTP, code, and knowledge nodes still need their respective Host services before they can claim equivalent direct execution.

## Validation

Workflow PTC guest, Host, engine, and UI compiler tests pass 114 tests. Workflow guest generation check, PTC TypeScript, UI Layout TypeScript, and workflow README translation pairing pass.
