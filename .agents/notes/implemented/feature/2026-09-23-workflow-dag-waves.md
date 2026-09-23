# Agent Note: Workflow DAG execution waves

Status: implemented

English | [中文](2026-09-23-workflow-dag-waves.zh.md)

## Problem

The visual compiler validated a DAG but executed every node in one sequential topological loop. Independent branches could not run concurrently, and a join node could be reached by whichever incoming branch appeared first in the loop.

## Decision

Compile the graph into dependency waves. Each wave is emitted as `Promise.allSettled` over isolated node tasks; the next wave starts only after every predecessor task in the current wave settles, and the first rejection then fails the run without starting downstream waves. Active edge state still controls condition branches. A join starts when at least one incoming edge is active after its dependency wave completes, and its input array contains every predecessor value that was produced; this is an OR join, not an all-branches barrier. The final result is read from the single end node rather than from a race between parallel tasks.

## Alternatives considered

**Reject a wave immediately with `Promise.all`:** Rejected because peer nodes could keep running after the script had already failed, leaving nondeterministic audit and cleanup timing.

**Continue downstream nodes after a partial wave failure:** Rejected because downstream inputs would be incomplete and could produce side effects from a known-invalid run.

## Consequences

Independent model, tool, knowledge, code, and HTTP-backed child tasks can overlap up to the Host workflow and PTC concurrency limits. A failed wave still waits for its peers to settle before failing, so active node audit entries close deterministically. Downstream waves never execute after a rejection. Branch joins have deterministic predecessor completion semantics; ordinary child failures retain the existing `null` result behavior. Loops remain rejected by graph validation.

## Validation

The UI compiler tests pass the DAG parallel-wave and join assertions, together with retry, branching, and tool-isolation coverage. UI Layout TypeScript passes.
