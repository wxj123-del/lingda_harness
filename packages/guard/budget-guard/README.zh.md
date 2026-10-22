---
description: "在步骤边界终止失控 Agent 轮次的运行时预算：步数、token、墙钟与会话轮数上限，以及软性交接提醒，供配置长会话的用户与维护者参考。"
kind: "package-reference"
---

# @deepseek-ai/dsh-budget-guard

[English](README.md) | 中文

## 概述

`dsh-budget-guard` 为单个 Agent 轮次设置硬上限。它统计模型步数、提供方上报的 token、经过的墙钟时间以及会话总轮数；当配置的上限被超过时，在下一个步骤边界终止该轮次，并追加一条持久的 `budget/stop` 记录，写明上限与观测值。触发上限之前会有一条建议性提醒，要求模型记录如何继续。未配置的上限表示不设限，因此部署需要显式选择每一项上限。

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

当 Agent 可能长时间无人值守运行、失控循环必须由策略而不是运气终止时挂载本 guard。`dsh` base bundle 已挂载它，但所有上限均未设置，因此除非部署主动配置，行为保持不变。

### 何时选择它

适合自主或定时执行、成本与时长必须有界的工作。纯交互会话不适合：用户每轮都在看，按轮步数上限与 personal-agent 模式上限重复，而墙钟上限可能切断一个本来就慢的长工具调用。

### 配置

```yaml
- name: '@deepseek-ai/dsh-budget-guard'
  config:
    maxStepsPerTurn: 40
    maxTurns: 200
    maxTokensPerTurn: 200000
    maxWallClockMsPerTurn: 1800000
    warnAtRatio: 0.8
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxStepsPerTurn` | 未设置 | 单轮模型步数；在第 `上限 + 1` 步之前终止 |
| `maxTurns` | 未设置 | 会话总轮数；超过上限的新轮次在任何模型调用前被拒绝 |
| `maxTokensPerTurn` | 未设置 | 单轮提供方上报的输入与输出 token 之和 |
| `maxWallClockMsPerTurn` | 未设置 | 从该轮第 1 步开始计算的经过时间 |
| `warnAtRatio` | `0.8` | 任一上限达到该比例时注入一次交接提醒；`1` 表示关闭 |

配置非法会在加载时失败：上限不是正整数，或比例超出 `0.1`–`1`，都会直接抛出而不是回退。

### 你会得到什么

上限被超过时，该轮以 `turn/end { kind: 'blocked' }` 结束，并写入一条 `budget/stop` 事件记录 `{ turn, reason, limit, observed }`。会话仍然可用：下一轮从新的计数开始，终止前写入的任务 `handoff` 会告诉下一轮从哪里继续。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

### 设计原则

- **在边界终止，绝不中断步骤中途。** 检查位于 `agent/pre-step`，被拒绝的步骤不会留下不完整请求或半执行的工具批次。
- **持久而非内存。** 终止是一条会话事件，恢复会话时能看到该轮为何结束。
- **逐项选择上限。** 未设置即不设限；组合不会意外继承一个它没有选择的成本上限。
- **只提醒一次。** 在 `warnAtRatio` 处只注入一条软提醒，要求写交接说明，而不在后续每一步反复提示。

### 计数

步数与轮数来自 `agent/pre-step` 载荷。token 从当前轮 `assistant/message` 的 usage 采样累加，并按轮去重。墙钟从该轮第 1 步被评估时开始计时。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 策略校验、计数器、pre-step 评估、提醒注入 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [guard 分组地图](../README.zh.md)——同组的循环卫生 guard。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-budget-guard)——每个受支持字段。
- [Personal Agent 模式](../../interaction/personal-agent/README.zh.md)——本 guard 所补充的按模式步数上限。

-----

<a id="model-experience"></a>
## 模型体验

### 提示词小节

#### 模型看到什么

一条两句话的常驻说明：预算可能在步骤边界终止本轮；收到预算提醒时，应记录剩余工作和如何继续。

#### Token 影响

固定；每次请求两句话。

#### KV 缓存影响

挂载组合不变时前缀稳定。

### 预算提醒

#### 模型看到什么

每轮最多一次，当任一已配置上限达到 `warnAtRatio` 时，注入下方插件来源的通知。

##### 预算提醒

```markdown
<budget_warning>
Approaching the turn budget (<steps n/max>, <tokens ~n/max>, <wall-clock ns/maxs>). If the objective is not yet complete, record the remaining work and how to resume it — a task handoff, a file, or a decision note — because the turn may stop at the next step boundary.
</budget_warning>
```

#### Token 影响

每轮最多一条短消息。

#### KV 缓存影响

只追加；位于可复用请求前缀之后。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **步数与 token 按轮而非按会话**——计数器每轮重置；只有 `maxTurns` 约束整个会话。
- **token 依赖提供方上报**——某次尝试未上报 usage 时，该次尝试不会被计入。
- **墙钟在两次 pre-step 评估之间计量**——单个极长的工具调用要等到下一步开始才会被观察到。
- **没有成本或货币预算**——上限是步数、token、轮数与时间；不应用提供方定价。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注明确不具权威性。理由记录在 [task-state Agent Note](../../../.agents/notes/implemented/feature/2026-10-19-long-task-durability.zh.md)。

</details>
