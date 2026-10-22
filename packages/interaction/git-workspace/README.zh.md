---
description: "面向本地 Agent 会话和 Web 设置页的 Git 工作区检查点与受保护源码更新。"
kind: "package-reference"
---

# @deepseek-ai/dsh-git-workspace

[English](README.md) | 中文

## 概述

`dsh-git-workspace` 在本地 Agent 轮次前后记录有界 Git 检查点，并为仓库界面提供受保护的克隆、推送和快进更新操作。快照包含仓库身份、分支、状态、差异统计和有界差异；如果会话 cwd 只是容器，还会发现其中的直接子仓库。记录检查点不会修改工作区，Git 失败也不会让轮次失败。

<a id="use"></a>
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

## 目录

- [使用](#use)
- [源码地图](#source-map)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="source-map"></a>
## 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务、配置、检查点事件和受保护的 Git 操作 |
| [`tests/git-workspace.spec.ts`](tests/git-workspace.spec.ts) | 轮次顺序和禁用插件覆盖 |

<a id="model-experience"></a>
## 模型体验

### Git 检查点上下文

#### 模型看到的内容

`agent/git-checkpoint` Session 事件为轨迹和导出消费方记录有界仓库事实。它服务于面向用户的会话视图，不会新增提示词段或工具 schema。

#### Token 影响

本包不会把检查点字段加入模型请求。只有消费方明确把检查点渲染进上下文时，才由消费方承担相应 Token 成本。

#### KV Cache 影响

记录检查点不会改变模型请求前缀或缓存策略。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 只检查带绝对路径 `cwd` 的会话。
- 每个字段都有大小上限，不是完整仓库导出。
- 未跟踪文件会出现在状态中，但其内容不会出现在 `git diff HEAD` 中。
- Git 失败会记录在检查点中，不会让 Agent 轮次失败。

不发布 runtime invariant companion，因为本插件的约定就是会话检查点事件本身，不另行拥有回放不变式。

<a id="dev-note"></a>
### 开发备注

服务负责 Git 进程调用和检查点持久化；UI 消费方只渲染事件，不获得修改权限。
