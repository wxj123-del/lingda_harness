# Agent Note: Minimal preset includes the configured model identity

Status: implemented

English | [中文](2026-09-15-minimal-preset-model-identity.zh.md)

## Problem

The Web `minimal` preset replaced the entire system prompt with a generic software-assistant persona and suppressed runtime context. Its model received no configured model identity and could answer identity questions with an unrelated model or vendor name.

## Decision

The complete persona interpolates `{{model}}` and `{{provider}}` from the current agent options through the existing system-prompt variables. It describes the configured route, including custom provider and model identifiers, without asserting a vendor behind a user-configured endpoint. The preset still exposes one persistent shell and suppresses other prompt sections and runtime context.

This partially supersedes the fixed Web persona in the [bare minimal runtime decision](../feature/2026-08-11-minimal-profiles-bare-two-tool-runtime.md). That decision retains ownership of runtime-context suppression and the standalone SDK configuration.

## Alternatives considered

**Hardcode DeepSeek as the model.** Rejected because the user can select another provider or model.

**Restore the global prompt and runtime context.** Rejected because the existing variables supply the missing identity without reintroducing unrelated instructions.

## Verification

The Web composition test renders the shipped minimal persona with DeepSeek and custom routes. The recorded Web minimal-preset replay pins the rendered identity in the logged system prompt and checks that additional sections and runtime-context messages remain absent.

## Consequences

Identity information adds one short clause to the prompt. It reflects the configured request route; it cannot verify what model a remote endpoint actually serves or guarantee a model's generated answer. Existing user-authored copies require the same template update.
