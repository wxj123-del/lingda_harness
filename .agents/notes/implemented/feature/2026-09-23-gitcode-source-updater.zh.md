# Agent Note：GitCode 源码更新器

Status: implemented

[English](2026-09-23-gitcode-source-updater.md) | 中文

## Problem

源码 checkout 的更新路径仍然查询旧的 AtomGit 地址，但当前维护的 Lingda Harness 仓库是 `https://gitcode.com/XJ-Cyber/lingda-harness`。

## Decision

浏览器 fallback 提交检查和 Host Git 更新器统一使用 GitCode 作为唯一更新源。抓取使用稳定的 `gitcode/main` tracking ref，比较本地分支和远程 head，并保留工作区干净、只允许快进更新的保护条件。设置页文案和包文档也统一改为 GitCode。

## Alternatives considered

继续使用旧 AtomGit 端点无法代表维护中的源仓库；支持多个更新提供方会引入分支和信任策略歧义，因此均未采用。

## Consequences

设置页按钮会检查用户实际需要跟踪的仓库提交。工作区干净时，可以通过现有 Host 更新操作快进同步、安装锁定依赖、重新构建并重启。工作区有修改、分叉、detached HEAD 或本地领先时仍然拒绝更新，避免数据丢失。

## Validation

Git workspace 和设置页更新测试通过。Client UI TypeScript、Remote TypeScript 以及 `git diff --check` 通过。
