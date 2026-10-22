# Agent Note: one shipped agent preset

Status: implemented

English | [中文](2026-10-21-single-shipped-preset.zh.md)

## Problem

Five agent presets shipped (`standard`, `diaosi`, `ptc`, `cordis`, `minimal`) while the Web deployment used exactly one: `modeSelectionEnabled: false` had already turned the picker off, and `default: diaosi` decided every session's composition. The other four were never the default and never appeared in the picker, yet each still shipped with a full assembly, its own tests, and its own copy.

The user-facing cost was that "mode" leaked into places where it meant nothing: a read-only preset label in the session header, a whole preset-management page in settings, and a switching chip on the new-session screen — all pointing at a set with one member.

## Decision

**The shipped set narrows to `diaosi` alone.** The `standard`, `ptc`, `cordis`, and `minimal` preset directories are deleted, including the two Skills bundled inside `cordis`. The preset mechanism itself stays: the `dsh-agent-presets` service, the `$DSH_HOME/.agent-presets` user root, and the copy and delete actions are untouched, because they still carry user-authored presets.

**Default and sole option both become `diaosi`.** `packages/bundle/web-app/cordis.patch.yml` already said `default: diaosi`; the Feishu webhook's `agentPreset` default moves from `standard` to `diaosi`, since otherwise that entry would name a composition that no longer exists.

**Display copy converges with it.** The built-in preset key table in `display.ts` and `ui-agent-preset`'s `AgentPresetSettingsKey` keep only `presetDiaosi*`; the `presetStandard*`, `presetPtc*`, `presetMinimal*`, and `presetCordis*` bilingual entries are removed.

**The authoring entry goes with it.** The "draft a custom preset with Creator mode" button in `ui-agent-preset` required the `cordis` preset to be on the roster (`state.rows.some(row => row.id === 'cordis')`) and hardcoded `seat.stage('cordis', true)`. With that preset gone the entry has nowhere to land, so `startCreatorDraft`, the `creatorDraft` state, the `CreatorButton` styles, and two copy keys are removed with it. Copying an existing preset remains.

## Alternatives considered

**Hide the UI and keep the four preset files.** Rejected: the request was that there need not be that many modes. Hiding alone leaves four unused full assemblies in the repository, and `cordis`'s bundled Skills keep shipping.

**Delete the `dsh-agent-presets` mechanism too and inline its capability into the single composition.** Rejected: user-authored presets under `$DSH_HOME/.agent-presets` and the copy/delete actions remain useful, removing the mechanism is an irreversible capability loss, and it would require rewriting both the web-app and base patch layers.

**Keep `cordis` as a "creator mode".** Rejected: the authoring entry only existed as a settings-page button, which `modeSelectionEnabled: false` already disabled; keeping an unreachable preset to prop up one button does not pay for itself.

## Consequences

The default experience becomes "open and type": no mode selection, no header label pointing at options that do not exist, and no four read-only rows in settings. The Feishu entry and the Web default name the same composition, so the old `standard`-versus-`diaosi` split cannot recur.

What it costs: a user who wants the fuller capability set (planning, goals, subagents, workflows) can no longer get it by switching presets, only by authoring one or editing `agent.cordis.yml`. The `cordis-plugin-development` and `editing-cordis-compositions` Skills vanish with that preset, while `tool-cordis`'s prompt still refers to the former — that tool was only ever mounted by the `cordis` preset, so no reference dangles today, but mounting `tool-cordis` in another composition requires shipping the Skill alongside it.

`/goal` returns with the shipped composition: `command-goal` and `tool-goal` now mount in `diaosi`, because the web-app layer still disables them and their only other mounter was a deleted preset.

Verification: all 340 cases across `packages/client/ui-agent-preset` and `packages/preset/agent-presets` pass, including the rewritten shipped-root, display, section, and apply cases. A new `apps/cli/tests/live-single-preset.e2e.ts` adds four cases covering the single roster entry and its default, reading from the shipped root rather than a copy, the read cap and compaction thresholds still holding, and `/goal` plus the goal tools being reachable. `npm run typecheck` reports no errors. `apps/cli/tests/web-agent-presets.e2e.ts` is retired wholesale (`describe.skip`, with the reason in its header): every case there used one of the five presets as the control for another, while the mechanism itself stays covered by `packages/preset/agent-presets/tests/`. `apps/web/tests/agent-preset-*.e2e.ts` were not rewritten and sit outside the default CI lane.
