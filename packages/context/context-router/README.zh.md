---
description: "按确定性规则路由请求上下文，生成有预算的模型快照。"
kind: "package-reference"
---

# @deepseek-ai/dsh-context-router

[English](README.md) | 中文

## 概述

`dsh-context-router` 保留追加式 Session 日志，同时为每次模型请求选择有界的可见快照。它把最新用户请求分类为 `fresh`、`recent`、`task` 或 `full`，始终保留系统消息和当前用户消息，并且不会发送缺少工具调用的孤立工具结果。每次决策还会记录机器可读的信号，例如 `explicit-full`、`co-reference`、`follow-up`、`lexical-match`、`open-turn` 或 `unrelated`，因此诊断可以区分选择同一大类路由的具体原因。一个 turn 尚未结束时，后续模型 step 会优先保留该 turn 的工具工作集；如果超过 token 预算，会先按原子工具单元裁剪较旧的工作集，再裁剪更早 turn 的历史。关键词路由只用于已结束 turn 之间的历史。

## 使用

`dsh-base` 会全局挂载本插件。默认每次请求保留最近 16 条消息，最多补充 32 条任务相关消息，并限制在估算 24,000 token 以内。`fresh` 会删除旧的普通对话历史；`task` 会补充与当前请求共享关键词的旧消息；`full` 会在 token 预算内保留完整历史。持久日志不会被删除或重写。

如果同时挂载 `personal-agent`，路由器会读取当前模式的 `maxContextTokens` 作为上限。personal-agent 不再重复裁剪历史或 Token 预算，只继续负责工具结果裁剪和重复上下文标记，因此每个请求只有一处历史选择和预算裁决。

```yaml
- name: '@deepseek-ai/dsh-context-router'
  config:
    recentMessages: 16
    taskMessages: 32
    recallMessages: 8
    pluginContextRatio: 0.25
    maxTokens: 24000
    safetyMarginTokens: 256
```

每次请求都会记录 `context/router` 审计事件，其中包含范围、原因、消息数量、估算输入 token、包含工具 schema 的 `estimatedRequestTokens`、包含输出预留的 `estimatedWindowTokens`、最终消息预算，以及每条选中消息的有限类型、Token 和预览元数据。元数据最多保留 128 条消息，并只保留截断后的预览，不复制完整消息正文；被省略的数量会单独记录。若 Session 已记录提供方的 `contextWindow`、输出 `maxTokens` 与工具 schema，路由器会先从模型总窗口中扣除输出和 schema，再选择消息，避免固定预算把小窗口模型推过上限。若完整请求包（消息、工具 schema 和输出预留）仍超过模型窗口，事件会单独记录 `requestOverflowTokens`。若系统提示词、当前请求或持久检查点等强制消息本身已经超过有效预算，事件会记录 `budgetExceeded` 与 `overflowTokens`，界面会显示警告；路由器不会为了满足数字上限而丢弃这些必要消息。该事件只用于诊断，不会成为模型上下文。当 provider runtime 在 adapter dispatch 前投影文件或图片内容时，路由器会追加有界的 `finalPayload` 审计，记录投影后的消息预览和投影标志，让上下文预览能够区分路由快照与 adapter-ready payload；等待中的 request-ready checkpoint 会在 dispatch 前持久化该审计。

`context/router` 审计还会记录机器可读的路由信号，让界面和诊断能够区分明确请求、指代、追问、关键词命中、开放 turn 与无关联请求，即使它们属于同一个大类范围。

消息和工具 schema 现在复用 `token-meter` 的公开启发式估算，因此路由裁剪与 Token 轨迹页使用同一套计量规则。进程内会按不可变消息和请求 header 对象的身份缓存估算结果，避免同一条长工具链在选择和审计阶段被重复计量。被动插件或检索上下文默认最多使用消息预算的 25%；当前开放 turn 的工作集不受这层二级上限限制，但仍受总预算约束。可以通过 `pluginContextRatio` 在 0 到 1 之间调整上限。

当提供方声明了上下文窗口时，`safetyMarginTokens` 会在选择消息前预留空间，用于吸收提供方 framing 和分词差异。默认值为 256，预留值会显示在审计和 Token 轨迹页面中。模型请求成功或失败且提供方上报 prompt 用量后，路由器会把每个 provider/model 最近最多 16 个偏差写入持久化的 `context/calibration` 事件；如果估算偏小，下一次请求的有界安全余量会按最多 1.25 倍增加，并封顶为 4,096 token。这种校准按路由隔离、重启后仍然有效，且不会修改持久化对话正文。审计会区分启发式估算、实际余量、最近一次提供方输入和样本数量。

对于 `it`、`它`、`前面提到的方案`、`这个文件` 等指代表达，路由器会围绕最近一轮用户消息执行有界的本地召回。默认召回 8 条消息，不调用 embedding 模型或其他 LLM。

简短的确认或继续指令（例如“好的”“收到”“明白了”“按这个来”）会继续关联近期任务，不会因为缺少关键词而被误判为新话题。如果 Session 中存在持久化的任务生命周期事件，继续指令还会召回最近一个任务的模型可见消息，并在路由审计中记录对应的 `taskId` 和召回数量。召回数量受 `taskMessages` 限制，因此简短确认不会隐式扩展为整个上一任务的 transcript。

对于 `recent` 和 `task` 路由，即使最新的持久压缩摘要不在消息数量尾部，也会保留它。明确的 `fresh` 路由仍会排除该摘要，因此用户声明切换话题时不会继承旧任务记忆。

路由器重启后，会从持久化的 `turn/start` 和 `user/message` 事件恢复开放工具 turn 的起点，因此恢复中的后续 step 仍能识别当前工作集边界，不只依赖内存状态。

持久任务召回使用按 Session 保存的增量索引。第一次查询会回放已有事件日志以保证重启后正确恢复；之后只折叠索引水位线之后新追加的事件，因此短追问不会反复扫描 50K 条事件的长日志。`turn/end` 会关闭当前消息关联，但任务生命周期记录仍会保留，供后续任务延续召回。

任务关键词匹配也复用该增量索引的有界倒排表，普通短问题只扫描有限的近期用户消息；历史任务匹配不会在每个请求中重新对整段 transcript 做分词。每个关键词最多保留最近 256 条消息候选，达到上限的高频词会回退到精确扫描，完整日志仍然保留不变。

## 模型体验

### 路由后的请求上下文

#### 模型能看到什么

模型会收到系统提示词、当前用户消息，以及本次请求路由选中的历史。新的普通 turn 使用 `recent` 范围；开放 turn 内的后续 step 会保留该 turn 的工具工作集，之后新 turn 的任务延续才会召回匹配的旧历史；明确要求完整历史时，则会在 token 预算内保留旧消息。预算紧张时，任务相关的用户消息和模型输出优先于被动插件上下文；开放 turn 的工具调用和结果仍优先于更早轮次。如果当前工具单元无法放入剩余预算，路由器不会用更早的小消息回填。完整 Session transcript 不会自动发送。

#### Token 影响

路由器默认把每次请求限制在估算 24,000 token 以内，同时完整保留持久 Session 日志。

#### KV Cache 影响

所选历史发生变化时，本次请求可复用的前缀可能减少。路由器不会重写旧消息或 compaction 记录。

## 已知限制与延期工作

路由规则是本地确定性的，不使用 embedding，也不会额外调用模型。除显式引用、近期性和共享关键词之外的语义召回，将在后续阶段扩展。
