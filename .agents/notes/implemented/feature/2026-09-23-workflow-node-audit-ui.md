# Agent Note: Workflow node audit UI

Status: implemented

English | [中文](2026-09-23-workflow-node-audit-ui.zh.md)

## Problem

The workflow editor received node-level audit data from the Host, but the canvas and historical run view did not make that data visible or actionable.

## Decision

The editor maps the selected run's latest audit entry onto canvas nodes. Running, completed, failed, skipped, blocked, and cancelled nodes receive distinct visual states. Selecting a node exposes bounded input/output summaries, duration, error, and retry budget. The run summary includes a node timeline; selecting a timeline entry focuses the corresponding canvas node. When a dependency wave fails, downstream nodes receive explicit `blocked` terminal entries so the run explains why they did not execute.

## Consequences

Live runs and runs loaded from persisted history use the same audit presentation. Older runs without audit data continue to render normally. Audit summaries remain read-only and retain the Host-side redaction and size limits.

## Verification

The workflow panel test suite covers status mapping, historical audit loading, node focus, summaries, duration, and retry display. The related workflow, Session Controller, and UI test suites pass.
