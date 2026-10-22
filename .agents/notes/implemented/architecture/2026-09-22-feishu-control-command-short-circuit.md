# Agent Note: Feishu control command short-circuit

Status: implemented

English | [中文](2026-09-22-feishu-control-command-short-circuit.zh.md)

## Problem

The Feishu adapter previously sent slash commands through the ordinary Agent follow-up path. Mode changes, compaction, and other human controls could therefore become model-visible user messages and start an unintended model turn.

## Decision

The Feishu adapter resolves registered slash commands before enqueueing ordinary Agent follow-ups. This keeps mode changes, compaction, and other human commands out of the model loop. Unknown slash commands are consumed with an admission error, while only non-command text becomes a model-visible Feishu user message. A small resolver also maps unambiguous Chinese mode phrases to the existing `/mode` command.

## Alternatives considered

**Forward every message to the Agent.** Rejected because control commands would compete with model input and could trigger work before the human operation completed.

**Treat unknown slash commands as ordinary text.** Rejected because a typo in a control command should produce an admission error rather than silently asking the model to interpret it.

## Consequences

Registered Feishu controls now settle before model follow-ups, and only ordinary text is recorded as a model-visible user message. The resolver remains local to the adapter and reuses the existing `/mode` command vocabulary.
