# Agent Note: Python PTC runs use the shared sandbox provider

Status: implemented

English | [中文](2026-10-01-python-ptc-sandbox-confinement.zh.md)

## Problem

The Python PTC backend executes model-generated code in a fresh CPython process, but a restricted permission policy previously did not constrain that process's filesystem effects. A model program could therefore read or write paths outside the requested workspace even when the surrounding session selected a restricted sandbox policy.

## Decision

The runtime resolves a sandbox policy for each request and asks the shared `dsh-sandbox` provider to confine the Python argv whenever the policy is not `danger-full-access`. A missing provider is a hard `sandbox-unavailable` failure; the runtime never silently falls back to an unrestricted child. The selected mode, enforcement result, and observed denial are returned in the PTC result so callers can distinguish policy selection from enforcement.

The child bootstrap is staged outside Linux's masked `/tmp` mount when the workspace-write profile is active. Staging remains private and is removed after each run, so a model process can only affect its own temporary copy.

## Alternatives considered

**Rely on Python-level path checks.** Rejected because model code can use alternate syscalls, native modules, or subprocesses that bypass application checks.

**Treat an unavailable sandbox as full access.** Rejected because that converts an infrastructure failure into an undisclosed privilege expansion.

**Share one staged bootstrap directory across runs.** Rejected because model code can rewrite the bootstrap; per-run materialization limits that effect to the current child.

## Verification

The runtime typechecks and passes targeted lint. With CPython 3.11, the complete Python runtime suite passes 287 tests with two intentional skips. Real sandbox tests verify that workspace-write permits workspace writes and denies an outside path, read-only denies workspace writes, and a missing provider fails closed. The runtime-closure and package dependency gates are also required before release.

## Consequences

Restricted Python PTC execution now depends on a correctly composed shared sandbox provider. Deployments that intentionally want unrestricted Python must explicitly select `danger-full-access`; that mode does not require a sandbox provider. Linux staging uses `/var/tmp` only for the host-visible bootstrap, while model-visible temporary files remain under the confined `/tmp`.
