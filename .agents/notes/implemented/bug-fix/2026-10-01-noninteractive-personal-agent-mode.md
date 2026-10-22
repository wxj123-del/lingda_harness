# Agent Note: Non-interactive profiles start in execution mode

Status: implemented

English | [中文](2026-10-01-noninteractive-personal-agent-mode.zh.md)

## Problem

The shared base profile starts new Personal Agent Sessions in `qa` mode. That default suits the Web mode selector, but Headless and SDK callers have no selector before their first prompt. Their Sessions therefore advertised no tools and rejected composed execution tools such as `bash` and `subagent` with `MODE_TOOL_DENIED`.

## Decision

The shared base profile retains `qa` as its interactive default. The Headless and SDK application patches replace the Personal Agent configuration with `execution` as the default and repeat the base mode step limits because a Cordis patch replaces the complete plugin configuration. Fresh Sessions can use every tool composed by those non-interactive profiles on their first prompt. A resumed Session continues to use the durable `agent/mode` event already in its log.

## Alternatives considered

**Use `coding` mode.** Rejected because `coding` deliberately omits tools such as `subagent`; non-interactive automation must expose the complete tool set composed by its profile.

**Change the shared base default.** Rejected because Web users have an interactive selector and retain the safer direct-answer default.

**Add a required mode argument to each caller.** Rejected as the only fix because existing Headless and SDK callers must remain functional without a new required field. A future optional override can layer over the profile default.

## Verification

Bundle tests compare each non-interactive override with the complete base policy and require only `defaultMode` to differ. Keyless Headless and SDK profile tests require `subagent` in the model-visible tools, while the Headless test also executes the real platform shell tool. Configuration verification checks the composed profile trees.

## Consequences

New Headless and SDK Sessions receive the full execution tool catalog and the `workspace-write` Personal Agent permission preset immediately. Existing persisted mode choices remain authoritative. Deployments that need a narrower unattended policy must provide an explicit profile patch rather than relying on the interactive `qa` default.
