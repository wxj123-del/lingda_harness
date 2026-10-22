# Agent Note: Desktop settings update action

Status: implemented

English | [中文](2026-09-21-desktop-settings-update.zh.md)

## Problem

Desktop already had a signed Electron release updater, but the application UI exposed it only through the native menu. Source checkouts and browser launches do not have a safe way to replace their running files.

## Decision

Expose a narrow update-only bridge to the trusted `dsh-app://app` renderer and register a General settings row that reuses the existing `DesktopUpdateCoordinator`. The row checks the configured signed Desktop release stream and can install an available release, while non-Electron browsers render nothing. Source checkouts continue to use the documented Git and build workflow.

## Alternatives considered

Keeping updates only in the native menu was rejected because it left the trusted Desktop settings surface without a discoverable action. Exposing a general-purpose filesystem or shell bridge was rejected because it would enlarge the renderer privilege boundary beyond update coordination.

## Consequences

Settings and the native menu share one single-flight check/install operation and one published state stream. The bridge exposes no filesystem, shell, or plugin controls to the application renderer. A source checkout still requires `git pull --ff-only`, dependency installation, a build, and a process restart; a GitHub commit is not treated as an installable Desktop release until the signed release artifacts are published.

## Validation

Focused settings, preload, and Desktop build checks pass. The repository-wide client i18n check still reports three pre-existing hard-coded strings in `ui-trajectory/WorkflowView.tsx`.
