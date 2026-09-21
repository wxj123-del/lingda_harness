# Agent Note: Explicit mobile Web access

Status: implemented

English | [中文](2026-09-21-mobile-web-access.zh.md)

## Problem

The Web GUI already authenticated LAN requests and printed a derived LAN URL, but the CLI refused the all-interface bind, so a phone on the same network could not connect.

## Decision

Add an explicit `--mobile` flag to the Web startup provider. It selects the existing `0.0.0.0` webserver bind, keeps LAN IP discovery and Host/Origin plus token authentication unchanged, and prints a warning to share the token-bearing LAN URL only on a trusted network. Direct `--host 0.0.0.0` remains rejected, and `--mobile` cannot be combined with `--host`.

## Alternatives considered

**Allow `--host 0.0.0.0` directly.** Rejected because a lower-level bind flag makes network exposure easy to enable accidentally.

**Add a separate phone app or pairing protocol.** Deferred because the browser GUI, signed cookie exchange, and LAN trust fence already provide the required mobile path without a second client or persistence protocol.

## Consequences

Run `dsh web --mobile --no-open`, then scan the printed terminal QR code on a phone on the same trusted network. The QR code and fallback `LAN:` URL contain the process token for this run; restarting the process invalidates it. No session events or RPC methods are required; the terminal QR renderer is the only new runtime dependency.

## Validation

Focused startup, Web runtime, and LAN-trust tests pass (`26` tests). Documentation pairs were refreshed.
