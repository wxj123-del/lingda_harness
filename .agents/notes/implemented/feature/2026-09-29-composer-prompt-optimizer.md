# Agent Note: Model-backed composer prompt optimizer

Status: implemented

English | [中文](2026-09-29-composer-prompt-optimizer.zh.md)

## Problem

The DSH composer accepts free-form drafts, but users often need to restate the goal, context, constraints, and expected output before sending. There was no in-place editing aid, and the browser had no Session-addressed operation for asking the selected model to rewrite a draft.

## Decision

Add a composer toolbar control that opens an editable prompt-optimizer panel. The panel sends the current draft and a general, code, writing, or analysis mode to a new Session Controller Remote. Host calls the Session's selected provider/model through an auxiliary `ctx.llm.stream()` request without a `sessionId` or Session event, then returns only text. Users can edit the result, copy it, or apply it back to the existing draft through `InputActions.setDraft`. Empty drafts, slash commands, and locked/submitting input disable the control. Closing, mode changes, and unmount cancel pending requests; failures remain retryable.

## Alternatives considered

**Use a deterministic browser template.** Rejected because it does not provide the requested AI optimization and cannot adapt to the user's actual intent.

**Rewrite the draft immediately on icon click.** Rejected because users need to inspect and edit the proposed wording before it becomes the message they will send.

## Consequences

Optimization is asynchronous and provider/model-dependent, while the preview remains editable and reversible until the user applies it. The auxiliary call is not part of the Session transcript and its result becomes ordinary user draft content only after explicit application. The Host owns model selection, input bounds, cancellation, output validation, and prompt-injection-resistant instructions.
