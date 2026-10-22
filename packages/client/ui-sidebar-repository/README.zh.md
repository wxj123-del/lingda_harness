---
description: "右侧边栏的源代码管理标签页：分支状态、已暂存与未暂存变更分组、暂存操作、提交与拉取，基于 gitWorkspace Remote 命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-repository

[English](README.md) | 中文

## 概述

本包为 Web GUI 的右侧边栏增加一个仓库标签页。它显示当前分支、领先/落后数量、已暂存与未暂存的变更分组以及最近历史，并提供暂存、取消暂存、提交和拉取。所有操作都通过 `gitWorkspace` Remote 命名空间完成，浏览器从不直接读取工作副本；每次变更都会写回 Host 变更后读取的快照，使行与计数保持一致。本包不向 Host 树贡献任何内容。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在同时加载 `gitWorkspace` Remote 面的 Web 组合中挂载本插件。标签页会以名为 `repository` 的右侧边栏类型出现；打开它会为当前会话的工作区解析仓库并渲染面板。

### 面板显示什么

分支行显示工作副本及其上游，并给出领先/落后数量。其下按变更类型分组展示已暂存与未暂存变更，最近历史列出提交。有操作进行中时，会禁用与之竞争的动作。

### 操作

暂存与取消暂存在分组间移动单个文件；提交需要填写消息；拉取执行抓取与合并。每个动作都是一次 Remote 调用，结果直接替换 store 中的快照而不是乐观合并，因此 Host 侧的并发变更不会让面板停留在过期的分组上。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

本包把纯状态视图与异步面分开。`state-view.ts` 从快照推导渲染所需的行与分组；`face.ts` 执行 Remote 调用并通过 store 自身的 action 写入结果。组件从不等待：它调用注入的回调，从而让每次写入都留在框架可观察的 store 中。

标签页通过两段式公开路径注册——类型注册到 `ctx.sidebarRightTabs`，主体注册到带键的 `sidebar.right.pane.tab` 座位，标题注册到 `sidebar.right.pane.tab.title`，两者都以该类型的 id 为键——并把文案绑定在 `sidebarRepository` 命名空间下。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 侧，刻意留空 |
| [`src/client/index.ts`](src/client/index.ts) | 注册标签页类型、字典、主体座位与标题座位 |
| [`src/client/face.ts`](src/client/face.ts) | Remote 调用、取消与快照写回 |
| [`src/client/state-view.ts`](src/client/state-view.ts) | 纯函数式的行与分组推导 |
| [`src/client/store.ts`](src/client/store.ts) | 按标签页隔离的状态与待处理动作 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [客户端分组地图](../README.zh.md)——浏览器侧包家族及其 slot 约定。
- [右侧边栏](../ui-sidebar-right/README.zh.md)——本包注册使用的标签页注册表与带键座位。
- [git 工作区](../../interaction/git-workspace/README.zh.md)——面板调用的 Host 侧 Remote 命名空间。

-----

<a id="model-experience"></a>
## 模型体验

无。本包只注册浏览器侧的边栏标签页，不贡献任何工具、提示词或会话事件。

#### KV 缓存影响

不会失效：本包没有任何内容进入请求组装。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **每个会话工作区一个仓库**——没有工作区路径的会话不显示仓库，也不支持多仓库工作区。
- **没有差异查看器**——面板只列出变更文件；打开差异属于文档预览界面的职责。
- **不处理冲突解决**——产生冲突的拉取会呈现失败，由用户在 harness 之外解决。
- **Host 侧为空**——标签页完全是浏览器侧的；需要 Host 工作的部分属于 `git-workspace`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注明确不具权威性。

</details>
