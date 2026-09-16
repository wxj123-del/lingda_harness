# Agent Note: Lingda as a bundled npm distribution

Status: implemented

English | [中文](2026-09-16-lingda-npm-distribution.zh.md)

## Problem

A renamed entry package that depends on registry versions of `@deepseek-ai/*` installs upstream code instead of Lingda's customized packages. Renaming every workspace package would also change internal imports and plugin identities.

## Decision

The [Lingda pack command](../../../../scripts/release/lingda.ts) gathers the local runtime dependency and peer closure rooted at the CLI and the optional media and Token trace plugins. It uses `pnpm pack` to honor each package's publication files and includes the tarballs and SHA-512 checksums in one `lingda-harness` archive. On first launch, the [runtime installer](../../../../distribution/npm/runtime.mjs) verifies the tarballs and installs them as explicit local dependencies alongside external dependencies. It publishes the completed runtime directory through an atomic rename. Caches are separated by archive contents, platform, and Node ABI. The [launcher](../../../../distribution/npm/bin/lingda.mjs) boots the existing CLI in process and defaults data to `~/.lingda` while honoring `DSH_HOME`.

The [upstream release sequences](2026-08-10-npm-release-sequences.md) remain independently useful for upstream package maintenance. Lingda's distribution does not publish into their package namespace.

## Alternatives considered

An alias depending on upstream npm packages drops local customizations. Publishing renamed copies of every workspace package expands the change across imports, plugin manifests, and config trees. Downloading and building source on each user's machine adds development tooling to first launch. npm bundled dependencies without their complete external closure omit required external packages. Shipping local tarballs and installing their complete dependency tree preserves plugin identities and removes the consumer build step.

## Consequences

Each release needs a complete build and a new distribution version. The archive is larger than a thin launcher. Validation covers missing local dependencies, portable dependency selection, a clean installed archive, and actual Web startup. npm authentication and publication are separate from packing. Optional native binaries retain their upstream versions, so platform checks remain necessary before claiming support for a platform.
