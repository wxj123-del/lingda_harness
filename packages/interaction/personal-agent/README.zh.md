---
description: "本地 Agent 模式、持久化策略、有界工具和任务生命周期状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-personal-agent

[English](README.md) | 中文

## 概述

`dsh-personal-agent` 拥有当前 Agent 模式，并在模型呈现和工具执行两个边界应用策略。它把模式和任务生命周期事件持久化到 Session 日志。

## 目录

- [使用本包](#use)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use"></a>
## 使用本包

在 Cordis 组合中挂载插件。默认模式包括 `qa`、`research`、`coding` 和 `execution`；每种模式声明可见工具、步骤和上下文预算、审批行为及沙箱姿态。

服务通过 Host 和 Remote 接口暴露当前模式与任务状态。模式变化和任务转换都会持久化，因此恢复或 fork 的 Session 可以重建活动策略和任务快照。

<a id="model-experience"></a>
## 模型体验

### 策略边界

#### 模型能看到什么

模型只会收到当前 `agent/mode` 允许的工具和上下文。隐藏工具 schema 不等于授权；执行边界会在调用运行前再次校验同一策略。

#### Token 影响

模式级上下文和工具限制会约束请求。策略审计事件只写入 Session 日志，不会加入模型提示词。

#### KV 缓存影响

切换模式可能改变工具前缀，从而改变后续轮次可复用的请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 模式策略是本地配置，不包含组织级策略同步。
- 任务快照是有界元数据，不能替代完整的 Session 事件历史。

不会发布 runtime invariant companion，因为本包拥有策略和任务事件，而不是独立的回放不变量。

<a id="dev-note"></a>
### 开发备注

本包是带有生成 Client 和 Remote 接口的 Host service。沙箱与审批策略包仍分别拥有各自的执行权威。
