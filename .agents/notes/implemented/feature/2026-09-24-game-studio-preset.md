# Agent Note: Game Studio preset

Status: implemented

English | [中文](2026-09-24-game-studio-preset.zh.md)

## Problem

Playable-ad production, game-editor development, and game-toolbox maintenance share a production workflow, but the shipped presets only describe general coding, token-saving, PTC, minimal, and preset-authoring work.

## Decision

Ship a `game-studio` preset that includes the Standard composition and overlays a production-oriented persona plus a curated 20-skill shelf for the three work tracks. The persona requires phase-based execution, recoverable checkpoints, background-job collection, canonical preview/compiler/export paths, and explicit release states. The shelf combines local Studio runbooks, the browser-game production skills from `openai-api-curated/game-studio`, and the Codex-local playable production skills used for onboarding, packaging, compliance, localization, and NAS delivery. Its checked-in inventory records these sources. The runbooks keep playable source assets immutable, keep editor-specific behavior inside reviewed packages, and preserve toolbox compatibility and evidence.

The preset is a separate built-in composition rather than a change to Standard, so general coding sessions keep their current behavior and users can choose the studio workflow only for new sessions.

## Alternatives considered

**Change Standard globally.** Rejected because the production gates and release vocabulary would add noise to ordinary coding sessions.

**Use only a system-prompt paragraph.** Rejected because the studio workflow needs bundled, loadable runbooks and a distinct selectable identity, not just prose that can drift from the skills it names.

**Create three separate presets.** Rejected for the first version because the three tracks share checkpoints, background-job handling, and evidence discipline; track-specific runbooks keep one studio entry point without duplicating the full Standard composition.

**Load the entire local Codex skill directory.** Rejected because it would make unrelated, machine-specific workflows available inside the preset and make releases depend on the current workstation. Competitive-research skills and the 126 MB mobile-game automation system remain outside the direct editor and playable production shelf.

## Consequences

The built-in picker exposes `游戏工作室模式` / `Game Studio mode`. Its composition reuses Standard through `cordis:include` and adds 20 bundled skills, so capability fixes in Standard remain shared while the skill set does not depend on a user's home directory. Game Studio routes each phase to the smallest necessary subset instead of loading every skill body into the model context. Existing sessions are unchanged; new sessions can select the preset. External platform, checker, and device validation remains an explicit human or external-system responsibility.
