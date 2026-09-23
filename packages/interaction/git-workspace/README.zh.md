---
description: "面向本地 Agent 会话和 Web 设置页的 Git 工作区检查点与受保护源码更新。"
kind: "package-reference"
---

# @deepseek-ai/dsh-git-workspace

[English](README.md) | 中文

## 概述

`dsh-git-workspace` 记录本地会话的有界 Git 证据，并为仓库界面提供受保护、明确触发的克隆与同步操作。它在每轮开始和结束时记录工作区快照，包括仓库根目录（可用时记录 origin URL）、当前分支、简短状态、差异统计和统一差异。如果会话 cwd 本身不是仓库但直接包含一个子仓库，快照会解析该子仓库。恢复已有 Git 检查点的会话时，会立即安排一次新的结束检查点，因此仓库目录变化后无需发送新消息，界面也能更新。克隆和同步会拒绝不安全的 URL、无关的非空目录、有未提交修改的工作区以及无法快进的更新。事件可忽略，轨迹客户端可以直接展示，不依赖某一种 Agent 模式或 preset。

插件在记录检查点时不会修改工作区。Remote 更新操作会直接检查 `https://gitcode.com/XJ-Cyber/lingda-harness`，即使 checkout 没有配置 `gitcode` 远程也可以工作；它只接受干净且可以快进的工作区，然后安装锁定依赖、重新构建项目并安排 Host 重启。存在未提交修改、分叉、detached HEAD 或本地领先时会拒绝更新。

## 使用

在 Cordis 根上下文中组合 `GitWorkspaceService`。基础组合包默认挂载此插件，因此 CLI、Web 和 preset 会话只要带有绝对路径 `cwd`，就会自动产生检查点。

```yaml
git-workspace:
  enabled: true
  maxStatusBytes: 24000
  maxDiffStatBytes: 4000
  maxDiffBytes: 24000
```

`agent/git-checkpoint` 是轨迹 UI 和导出的稳定集成点。Git 数据缺失或采集失败时，消费方应将其显示为不可用，同时继续渲染会话。

## 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务、配置、检查点事件和受保护的 Git 操作 |
| [`tests/git-workspace.spec.ts`](tests/git-workspace.spec.ts) | 轮次顺序和禁用插件覆盖 |

## 限制

- 只检查带绝对路径 `cwd` 的会话。
- 每个字段都有大小上限，不是完整仓库导出。
- 未跟踪文件会出现在状态中，但其内容不会出现在 `git diff HEAD` 中。
- Git 失败会记录在检查点中，不会让 Agent 轮次失败。

不发布 runtime invariant companion，因为本插件的约定就是会话检查点事件本身，不另行拥有回放不变式。
