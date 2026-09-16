# Agent Note: Default presets omit the shared skill catalog

Status: implemented

[English](2026-09-15-default-presets-omit-shared-skill-catalog.md) | 中文

## Problem

默认 Web Agent 会发现共享 `<agentsHome>/skills` 根目录下的所有 skill，并把完整目录追加到第一次模型请求中。用户无关的全局 skill 可能因此在 Agent 还没有遇到需要它们的任务之前就增加数千个提示词 token。

## Decision

`dsh-skill-filesystem` 提供 `includeAgentsHome`，默认值保持为 `true` 以兼容已有组合。随附的 `standard`、`ptc` 和 `cordis` preset 将它设为 `false`，因此 Agent 仍保留项目 skill、Harness 根目录 skill、自定义根目录和随 preset 提供的 skill，同时省略共享全局根目录。需要这些 skill 的部署可以在后续 preset patch 中显式启用共享根目录。

## Alternatives considered

**移除第一次请求中的 skill 目录。** 这样会阻止模型根据描述选择明显匹配的 skill，也会改变现有 skill 调用约定。

**统一缩短 skill 描述。** 这样只能降低成本，仍会发送无关的全局 skill，无法处理目录过大的来源问题。

**关闭所有默认 skill 根目录。** 这样也会移除与当前部署相关的项目 skill 和 Harness 根目录 skill。

## Consequences

默认 preset 不再让共享全局 skill 对模型可见。显式的项目、Harness 根目录、自定义和随包 skill 发现仍然可用；设置 `includeAgentsHome: true` 可以恢复原有行为。第一次请求仍包含选定 preset 所需的工具定义；降低这部分独立的工具 schema 成本需要另行设计按会话加载工具。
