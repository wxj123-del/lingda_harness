---
description: "面向长任务的持久任务状态：最后写入生效的任务快照、每轮复诵、带证据的完成判定，以及自动命令证据，供组合或调试长会话的用户与维护者参考。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-state

[English](README.md) | 中文

## 概述

`dsh-task-state` 为每个会话保留一个持久任务，而不是让目标只存在于早先的某条消息里。模型创建任务时写明目标与可验证的验收条件，随工作推进记录证据，并且只有在每条验收条件都有通过证据时才能标记完成。每轮开头注入一张紧凑卡片，重述目标、验收条件和缺失证据，因此触发压缩或经历很长的工具链之后，任务仍然可见。任务处于活动状态时，已结算的 shell 命令会被自动记录为证据。适用于跨多轮的工作；单轮清单仍应使用 `todo_write`。

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

当 Agent 需要在多轮之间维持同一个目标时挂载本插件。挂载后会加入 `task_update` 工具、一段说明策略的提示词小节、每轮卡片，以及自动命令证据观察者。

### 何时选择它

适合完成情况需要可证明的多轮工作：重构、迁移、长时间排查。单轮问答和只以对话为交付物的任务不适合使用；任务会带来一个工具 schema、一段提示词小节和每轮一张小卡片。

### 配置

```yaml
- name: '@deepseek-ai/dsh-task-state'
  config:
    injectTaskCard: true
    recordCommandEvidence: true
    requireVerifiedEvidence: true
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `injectTaskCard` | `true` | 在每个顶层轮次开头以插件来源的 user 消息追加紧凑卡片 |
| `recordCommandEvidence` | `true` | 任务活动时，为每次已结算的 `bash`/`pwsh` 调用追加自动证据记录 |
| `requireVerifiedEvidence` | `true` | 完成判定要求被观测到的证据：自动记录，或会话日志中确实以 0 退出的同名命令 |
| `reverifyEvidence` | `false` | 标记完成前重跑每一条已核验命令 |
| `reverifyTimeoutMs` | `300000` | 单次复验运行的墙钟上限 |
| `maxReverifyCommands` | `8` | 一次完成尝试中重跑的不同命令上限 |

### 你会得到什么

`task_update` 每次调用都返回完整任务，包括仍然缺少通过证据的验收条件序号（从 1 开始）。创建任务时缺少目标会失败；只要有验收条件缺少通过证据，标记 `succeeded` 会带着缺失序号失败；显式 `cancelled` 随时允许。证据记录包含 `kind`、精确的 `ref`、`status` 以及覆盖的验收序号。自动记录带 `auto` 标记；最多保留 40 条，超出时优先丢弃最早的自动记录。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

### 设计原则

- **状态保存在会话日志中。** 每次变更追加一份完整的 `task/state` 快照，重放时最后写入生效，恢复会话无需重读任何消息即可重建任务。
- **验收是契约，不是注释。** 覆盖率只来自通过状态的证据，不来自模型声明，因此没有证据的完成声明会在工具边界被拒绝。
- **卡片即复诵。** 压缩会替换历史；下一轮卡片恢复目标、验收条件、未覆盖序号、最近失败与交接说明，不依赖任何摘要。
- **有界。** 卡片有界、目标会截断、证据与决策有上限，长任务不会让每次请求无限膨胀。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | 投影键、持久快照类型、自动证据标记 |
| [`src/state.ts`](src/state.ts) | 纯函数式的补丁应用、覆盖率计算、卡片与 JSON 视图 |
| [`src/index.ts`](src/index.ts) | 投影注册、`task_update` 工具、卡片注入、命令证据观察者 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Todo 分组地图](../README.zh.md)——`task-state` 与 `tool-todo` 的关系。
- [生成的持久化目录](../../../docs/persistence-catalog.zh.md)——`task/state` 载荷结构。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-task-state)——模型收到的 `task_update` schema。

-----

<a id="model-experience"></a>
## 模型体验

### 提示词小节

#### 模型看到什么

一段固定文本说明任务策略：创建一个带可验证条件的任务，记录证据时写明覆盖的序号，条件缺少证据时期望被拒绝，暂停前使用 `handoff`，并记住任务每轮会被重述。

#### Token 影响

固定；每次请求一段短文本。

#### KV 缓存影响

挂载组合不变时前缀稳定。

### 每轮任务卡片

#### 模型看到什么

在每个顶层轮次的第 1 步，一条插件来源的 user 消息携带下方卡片。没有决策或交接说明时省略对应行。

##### 任务卡片

```markdown
<task_state>
Objective: <objective, truncated to 240 characters>
Status: <status> (revision <n>)
Spent so far: <total> tokens (in <input>, out <output>, <cached> cached)
Acceptance:
  1. <criterion> [covered]
  2. <criterion> [MISSING EVIDENCE]
Recent failing evidence:
- <kind>: <ref>
Decisions:
- <decision>
Handoff: <handoff>
</task_state>
```

#### Token 影响

随数据变化但有界：目标最多 240 个字符，每条验收条件一行，最近三条失败记录、最近五条决策，以及一行交接说明。消耗行只在挂载了 token meter 时出现；缓存子句只在有缓存读取上报后出现。

#### KV 缓存影响

轮内只追加；卡片是轮次边界上的新消息，而不是改写早先消息。创建或编辑任务的轮次只会改变下一轮的卡片。

### 工具 schema 与结果

#### 模型看到什么

[`task_update` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-task-state) 接受 `objective`、`acceptance`、`evidence`、`decision`、`handoff` 和 `status`。每次调用返回带覆盖标记和未覆盖序号的任​​务视图；失败信息为 `Error: cannot mark the task succeeded: acceptance <indices> lack passing evidence; record evidence with acceptance indices first` 和 `Error: creating a task requires objective`。

#### Token 影响

每次请求一个工具 schema；结果随保留的证据与决策数量增长。

#### KV 缓存影响

只追加；已有前缀条目仍然可复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明任务在哪些情况下并不适合。

- **每个会话只有一个任务**——创建第二个目标会替换第一个；不建模子任务。
- **`manual` 证据仍属声明**——`command` 或 `test` 记录需要一条被观测到的执行，`file` 记录需要一次对应该路径的读取，而 `manual` 记录没有任何可观测的对象。
- **复验读取既有历史，不重新执行**——早先成功过的命令会被认可，因此之后才发生的破坏不会在完成时被检出。
- **覆盖率按验收条件全有或全无**——任意覆盖该序号的通过记录即视为满足；不建模部分覆盖或加权覆盖。
- **任务变化时会重新附上卡片**——每轮第 1 步，以及后续任何任务版本与上次卡片不同的步骤，因此轮次中途创建的任务当轮即可见。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注明确不具权威性。理由与开放方向记录在 [task-state Agent Note](../../../.agents/notes/implemented/feature/2026-10-19-long-task-durability.zh.md)。

</details>
