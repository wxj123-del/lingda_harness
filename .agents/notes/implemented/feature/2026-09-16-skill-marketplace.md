# Agent Note: Local Skill marketplace

Status: implemented

English | [中文](2026-09-16-skill-marketplace.zh.md)

## Problem

The Skill page opened an empty editor and hid the two built-in authoring Skills already available to the model. Users could neither browse capabilities by purpose nor select a Skill for a conversation without knowing its generated runtime name.

## Decision

The page presents a local catalog of built-in and saved user Skills, with source filters, persisted categories, search, instruction details and a separate editor. Create Skill and Create Workflow share their identities and localized content with Host registration. Existing user records default to General. Categories remain UI metadata, while user Skill descriptions include their title for model discovery.

Use in chat prepares the exact registered slash invocation through the existing Conversation input service. It preserves the selected Session and draft, creates a Session if necessary, and never submits a model request. The layout navigation signal prevents a delayed Session creation from overriding a later navigation. Settings writes resolve before the editor closes; failures preserve the draft.

New entries use Upload Skill instead of an empty creation form. A bounded ZIP parser recognizes one `SKILL.md`, validates YAML and invocation flags, and rejects unsafe or duplicate paths. The user reviews the parsed fields and resource list before saving; same-name uploads explicitly update the existing import. The original archive stays in settings, while a lazy Skill provider revalidates and extracts resources into a content-addressed Host directory on load. No script runs during import. The built-in creator emits upload-compatible instructions.

## Alternatives considered

**Retain the editor as the first screen.** It hides available capabilities and does not meet the browsing use case.

**Build an external marketplace immediately.** Hosting, trust, publishing and download protocols are separate capabilities. A local catalog provides the requested initial experience without simulated listings or installation counts.

## Consequences

The two built-in Skills are available without installation. Their instructions generate editor-ready content, not automatic saved records. Custom Skills remain editable and disabled entries cannot be selected for chat. Component tests cover filtering, exact invocation, disabled state and failed-save recovery; a real-host browser scenario covers persisted categories, responsive widths and preserving composer text.

Archive tests cover nested bundles, binary resources, invocation flags, invalid metadata, traversal and size limits. Browser coverage verifies upload, preview, persistence, resource loading and chat handoff. Archives are limited to 2 MiB compressed, 8 MiB expanded and 256 entries. Only ZIP and one Skill per archive are supported. Remote filesystems must expose the Host resource directory to use attachments.
