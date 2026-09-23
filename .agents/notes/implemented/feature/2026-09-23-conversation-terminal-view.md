# Agent Note: Session-local Conversation terminal

Status: implemented

English | [中文](2026-09-23-conversation-terminal-view.zh.md)

## Problem

The interactive terminal was only reachable through the right Sidebar, while a Session's primary navigation already exposes its Conversation Views. Users need a predictable terminal entry beside those views and must not see one Session's shell state in another Session.

## Decision

`ui-sidebar-terminal` registers a `conversation.view` entry with id `terminal` after the existing transcript views. The entry resolves `ctx.webTerminals.view(sessionId, 'conversation-terminal', conversationTerminalId(sessionId), undefined, true)`, giving every Session one deterministic, lazy terminal identity while preserving the existing multi-instance Sidebar terminal feature. The shared xterm screen renderer is used by both surfaces, and both read the application theme through the same observable.

Switching away from the view only detaches the browser stream; the Client terminal model keeps the PTY alive and reconnects when the view returns. Recovery skips the reserved deterministic identity so a reload does not duplicate it as a Sidebar tab. Session ownership remains in `api-terminal-controller`, so separate Session ids produce separate Host terminal identities and process lifetimes.

## Alternatives considered

**Reuse the Sidebar terminal occurrence.** Sidebar tabs are user-created and can be duplicated, moved, or closed independently; binding the Conversation tab to one of them would make its availability and lifetime depend on another surface.

**Create a new terminal package.** The existing package already owns the terminal UI, theme behavior, and controller injection. A second package would duplicate xterm lifecycle code and split terminal documentation.

**End the shell whenever the Conversation View unmounts.** View changes and Session navigation are presentation changes, not an explicit close request. Detaching preserves interactive state and matches Sidebar switching semantics.

## Consequences

Every Session that opens the Conversation terminal consumes one Host terminal slot until the controller or Session owner cleans it up. The terminal tab is available only when the terminal controller and PTY backend are composed; existing Sidebar terminals and recovery behavior are unchanged.
