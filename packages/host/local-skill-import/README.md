---
description: "Host-owned discovery and bounded import of local Codex and Agents Skills."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-local-skill-import

English | [中文](README.zh.md)

## Summary

This Host plugin scans `~/.codex/skills` and `~/.agents/skills` for `SKILL.md`,
then exposes validated candidates to the Skill marketplace. A selected Skill is
re-read and packaged as a bounded ZIP for the existing import confirmation flow.

The scanner does not follow symbolic links or execute imported scripts. It caps
directory depth, file count, expanded bytes, and archive bytes. The Remote accepts
only opaque candidate IDs produced by the latest scan, never arbitrary local paths.

No runtime invariant companion is published; each import is revalidated directly
against the filesystem before bytes leave the Host.
