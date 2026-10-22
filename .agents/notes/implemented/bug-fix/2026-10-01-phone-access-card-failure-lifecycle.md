# Agent Note: Phone access card tolerates optional remotes and failed requests

Status: implemented

English | [中文](2026-10-01-phone-access-card-failure-lifecycle.zh.md)

## Problem

The Phone access settings card can be composed without the Host Phone Access Remote. Reading the missing namespace through Cordis's injected property proxy throws during startup. A transport rejection during tunnel generation also left the card's `generating` flag set forever, so the user could not retry.

## Decision

The card reads `remote.phoneAccess` through `ctx.get`, which returns `undefined` for an unmounted optional service. Tunnel generation catches transport failures, records an actionable failure string, and always clears `generating` and republishes the projection in `finally`. Successful and structured Remote failures retain their existing result handling.

## Alternatives considered

**Make Phone Access a required Client injection.** Rejected because the settings package is shared by profiles that do not compose the Host tunnel provider.

**Silently swallow generation failures.** Rejected because the card must explain a rejected request while remaining retryable.

**Recreate the controller after a failure.** Rejected because it would discard the staged credential form and hide a recoverable transport failure behind remount behavior.

## Verification

Client controller tests boot a real Cordis context with and without the Phone Access namespace. They assert absent-service startup settles, a rejected generation publishes a cleared busy state and error, and a subsequent generation succeeds. The targeted UI settings test file and Client lint pass.

## Consequences

Profiles may omit Phone Access without producing an unhandled startup rejection. A failed request remains visible in the card until the next generate or other state update, and the same controller can retry without losing form state.
