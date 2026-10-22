---
description: "Host-owned discovery and bounded import of local Codex and Agents Skills."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-local-skill-import

English | [中文](README.zh.md)

## Summary

This Host plugin scans `~/.codex/skills` and `~/.agents/skills` for `SKILL.md`, then exposes validated candidates to the Skill marketplace. A selected Skill is re-read and packaged as a bounded ZIP for the existing import confirmation flow.

The scanner does not follow symbolic links or execute imported scripts. It caps directory depth, file count, expanded bytes, and archive bytes. The Remote accepts only opaque candidate IDs produced by the latest scan, never arbitrary local paths.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

### Imported Skill archive

#### What the model sees

The marketplace exposes validated `SKILL.md` metadata and the bounded archive selected by the user. The model can use the imported Skill instructions through the existing Skill surface; arbitrary filesystem paths and bundled scripts are not exposed as model input.

#### Token effect

Only the Skill name, description, and any explicitly loaded instructions enter model context. Scanning and ZIP validation run locally and do not consume provider tokens.

#### KV Cache effect

Loading a Skill changes the appended instruction context for the current request and can change the reusable request prefix for later turns.

## Known Limitations and Deferred Work

- **Local roots only** — the scanner reads the configured Codex and Agents Skill roots on the Host machine; remote filesystems are not searched.
- **Bounded archives** — depth, file count, expanded bytes, and compressed bytes are fixed limits, so larger Skills require manual trimming.
- **No script execution** — imported scripts and assets are preserved but never executed by the importer.

No runtime invariant companion is published; each import is revalidated directly against the filesystem before bytes leave the Host.

### Dev Note

The Host owns filesystem scanning and archive validation; the marketplace and confirmation UI consume only the generated candidate id.
