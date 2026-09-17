# Agent Note: Tool exposure and call hit metrics

Status: implemented

English | [中文](2026-09-16-tool-usage-metrics.zh.md)

## Problem

Call totals alone cannot identify tools repeatedly sent to the model but rarely selected. Treating catalog size as executed calls obscures the source of input overhead.

## Decision

The existing tool-usage reader reconstructs the native catalog from the latest request header and counts an exposure for each tool on every settled assistant message or attempt. Headers only record changes, so counting header events would undercount repeated requests. The inherited prefix establishes catalog state without contributing exposures. Missing headers are reported separately; explicitly empty catalogs remain known.

Each exposed request with a matching direct call counts as one hit per tool. Matching uses the response's call ids, names, turn and step. Repeated calls increase call totals but contribute one hit. PTC internal calls retain separate counts. Compaction summaries and in-flight requests are excluded.

The Tools page presents exposures, hits, hit rates and request counts, with exposure and ascending hit-rate sorting. Summary totals describe the retained corpus independently of card filters. No exposure displays a dash. Metrics do not alter requests or automatically disable tools.

## Alternatives considered

**Divide calls by requests.** Repeated calls can exceed 100%, and internal calls need not appear in the native catalog. Distinct matching requests answer whether a carried tool was used.

**Persist new metric events.** Existing retained events support historical recomputation without adding a persistence format or a second mutable source of truth.

## Consequences

Low hit rate is review evidence, not proof that a tool is unnecessary or its definition tokens are fully billable. Results depend on retained logs; unreadable sessions and missing catalogs remain visible. Aggregate rate divides summed hits by summed exposures rather than averaging percentages. The metric measures selection, not success or task quality.

Unit coverage includes retries, repeated calls, header changes, inherited state, missing catalogs and PTC separation. Component and recorded-session browser coverage verify aggregate and per-tool values, sorting, refresh and narrow-screen presentation without model calls.
