---
description: "运行时预算停止或崩溃中断后的自动续跑：从任务交接说明继续活动任务，受尝试次数、冷却与 armed goal 约束。"
kind: "package-reference"
---

# @deepseek-ai/dsh-auto-resume

[English](README.md) | 中文

## 概述

`dsh-auto-resume` 让那些并非模型主动结束的工作继续下去。当某一轮因运行时预算或崩溃中断而结束时，只要会话任务仍处于活动状态且带有交接说明，插件就会追加一条持久的 `auto-resume/attempt` 记录，并排队一轮携带该交接说明的续跑。它绝不会续跑用户取消的轮次，不会重新驱动已完成的轮次，也不会与 armed goal 争抢——那种情况的续跑由 goal 驱动负责。

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

与 `dsh-task-state`、`dsh-budget-guard` 一起挂载。`dsh` 基础组合包以十次尝试挂载它；不希望自动续跑的组合可设置 `maxAutoResumes: 0`。

### 何时选择它

适合无人值守或定时执行、预算停止不应终结任务的工作。若每一轮都需要人工决定，则不适合——续跑会在无人确认的情况下消耗 token。

### 配置

```yaml
- name: '@deepseek-ai/dsh-auto-resume'
  config:
    maxAutoResumes: 10
    minIntervalMs: 1000
    requireHandoff: true
    resumeOnError: false
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxAutoResumes` | `3` | 每个会话的自动续跑次数；`0` 表示关闭该效果 |
| `minIntervalMs` | `1000` | 停止到触发续跑之间的最小空闲时间 |
| `requireHandoff` | `true` | 续跑前要求任务有非空的 `handoff` |
| `resumeOnError` | `false` | 是否在 LLM 错误结束的轮次后也续跑 |

### 什么情况下会续跑

| 上一轮结束原因 | 是否续跑 |
|---|---|
| 写入了 `budget/stop`（步数、token、墙钟） | 是 |
| 崩溃后尾部被标记为 `interrupted` | 是，等恢复后的 agent 空闲 |
| 用户取消（`aborted`） | 否——且该会话不再自动续跑 |
| 模型正常完成（`completed`） | 否 |
| 被阻塞但没有预算停止记录 | 否——重复会变成循环 |
| LLM 错误 | 仅在 `resumeOnError: true` 时 |
| 达到输出 token 上限（`max-tokens`） | 否 |

每个“是”还必须同时满足：任务活动且有交接说明、收件箱没有待处理用户输入、agent 空闲、没有 armed goal。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

### 设计原则

- **先持久化再可见。** `auto-resume/attempt` 记录在续跑提示词之前写入，因此两者之间发生崩溃时，下次启动仍会把它计入尝试次数。
- **只认已记录的停止原因。** 触发条件是记录下来的停止原因，而不是猜测模型是否“真的”完成。
- **续跑只有一个负责人。** 存在 armed goal 意味着 goal 驱动已经在续跑本会话，本插件让位。
- **取消是终局。** 用户取消会把尝试计数设为无穷大——这是用最少状态表达“本会话不再续跑”的方式。

### 计数与冷却

尝试次数按 agent 在内存中计数，并由持久记录背书。`minIntervalMs` 读取上次尝试时间，因此连续的停止不会产生连续的续跑。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 策略校验、按 agent 的状态、事件接线、续跑提示词 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [guard 分组地图](../README.zh.md)——同组的循环卫生 guard。
- [task-state](../../todo/task-state/README.zh.md)——本插件读取的任务快照与交接说明。
- [budget-guard](../budget-guard/README.zh.md)——本插件所回应的停止来源。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-auto-resume)——每个受支持字段。

-----

<a id="model-experience"></a>
## 模型体验

### 续跑提示词

#### 模型看到什么

一条插件来源的 user 消息，携带停止原因与任务的交接说明。

##### 续跑提示词

```markdown
<auto_resume reason="<reason>">
The previous turn stopped before the objective was complete (<reason>).
Resume from this handoff instead of restarting completed work:

<handoff>

Re-read the task card, verify the current workspace state, then continue.
</auto_resume>
```

#### Token 影响

每次续跑一条消息，外加它引用的交接说明文本；任务卡片会在下一轮第 1 步单独注入。

#### KV 缓存影响

只追加；续跑消息接在被中断轮次留下的可复用前缀之后。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **不检测“假完成”**——任务仍活动却以 `completed` 结束的轮次不会被续跑；该判断属于 goal 或人类。
- **崩溃恢复依赖宿主**——中断尾部路径只在宿主恢复 agent 时触发；本插件不会自行扫描会话。
- **尝试次数与日志对齐，而非按时钟历史**——每次判定前都会重读日志，因此重启会继承已记录的尝试；只有早于本插件写入的历史记录不可见。
- **每次空闲转换只续跑一次**——若续跑立即在同一预算上再次停止，需等下一个冷却窗口，而不是原地重试。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注明确不具权威性。相关理由记录在[长任务持久化 Agent Note](../../../.agents/notes/implemented/feature/2026-10-19-long-task-durability.zh.md)。

</details>
