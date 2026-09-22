# DSH 上下文按需召回改造规划

> 文档类型：实施规划
>
> 状态：阶段 0 基线已建立，阶段 1 待实施
>
> 目标：解决长任务积累大量历史后，用户提出无关简单问题仍携带完整历史的问题。

## 一、结论

本次改造不应继续单纯增加 compaction 次数，而应把“完整会话记录”和“本次模型请求上下文”拆成两个层次：Session 继续保存完整事实，请求组装阶段根据当前问题与历史任务的关联度按需召回上下文。

现有 DSH 已具备实现这项改造的大部分基础：Session 事件日志、`agent/request-context` 请求扩展点、Token 计量、compaction、知识库检索和 Personal Agent 上下文预算。改造重点是新增会话上下文范围、任务记忆、召回索引和请求级上下文路由，不需要重写 Agent Loop 或模型适配器。

第一阶段不引入向量模型，先使用显式上下文范围、活动任务、文件实体、错误码和关键词检索解决主要浪费。第二阶段再增加混合语义召回。这样可以先验证上下文减少效果，再承担语义检索的复杂度。

## 二、现状与问题

### 2.1 当前请求链路

当前 Agent 在模型请求前执行以下流程：

```text
Session 事件日志
  -> session.deriveMessages()
  -> agent/request-context waterfall
  -> LLM request
```

Agent Loop 在 [`packages/core/agent-loop/src/agent.ts`](../packages/core/agent-loop/src/agent.ts) 中从 Session 派生模型消息，然后调用 `agent/request-context`。这个扩展点只改变本次请求的消息快照，不删除 Session 的原始事件。

Personal Agent 在 [`packages/interaction/personal-agent/src/index.ts`](../packages/interaction/personal-agent/src/index.ts) 中提供了 `historyTurns`、`maxContextTokens`、工具结果裁剪、重复上下文处理和请求审计。它能够按照最近轮次和估算 Token 裁剪上下文，但它目前主要属于 Personal Agent 策略。

默认 Web `diaosi` preset 使用自己的 tool discovery 和 compaction。已有 preset 会话可能被 Personal Agent 标记为 unmanaged，因此不一定经过 Personal Agent 的历史裁剪。`diaosi` 的 compaction 在上下文压力接近阈值时触发，它解决的是上下文容量问题，不判断当前用户问题是否与旧历史相关。

### 2.2 典型问题

假设一个长任务已经积累 50K Token：

| 当前问题 | 当前风险 | 目标行为 |
| --- | --- | --- |
| “今天天气怎么样？” | 可能重复发送 50K 历史 | 只发送系统提示词和当前问题 |
| “刚才为什么测试失败？” | 需要历史证据，但不需要全部历史 | 召回失败摘要、命令结果和相关文件 |
| “继续修复订单统计工具” | 需要继续任务状态 | 召回任务摘要、约束、最近修改和未解决事项 |
| “那个 JSON 字段是不是错了？” | 需要定位实体 | 召回相关文件、错误和最近讨论 |
| “把刚才方案改成 Python” | 需要继承部分决策 | 召回目标、约束、方案和相关产物 |

问题的本质不是历史是否存在，而是每次请求是否应该把历史全部发送给模型。

## 三、目标与非目标

### 3.1 目标

1. 长 Session 继续完整保存，支持回放、审计、压缩和恢复。
2. 每个请求拥有独立的模型可见上下文快照。
3. 无关新问题默认不携带旧任务上下文。
4. 继续任务时自动保留任务目标、约束、决策、产物和未解决问题。
5. 需要历史证据时按关联度召回少量原文或摘要。
6. 记录本次请求选择了哪些上下文、为什么选择、估算占用多少 Token。
7. 模型可见内容能够从 Session 日志和确定性索引中重建。
8. 保证 system message、当前用户消息、工具调用和工具结果的完整性。

### 3.2 非目标

1. 不删除或改写现有 Session 原始事件。
2. 不把所有 Session 内容复制到一个不可追溯的向量数据库。
3. 不在第一阶段引入新的远程 embedding 服务。
4. 不让模型自己决定是否可以读取任意历史。
5. 不用摘要替代所有原始证据。
6. 不把 compaction 改造成任务管理器。
7. 不改变现有工具权限、审批和沙箱语义。

## 四、目标架构

```text
                    ┌────────────────────────┐
                    │ Session append-only log │
                    │ 完整事实、事件、消息    │
                    └───────────┬────────────┘
                                │ 派生
                ┌───────────────┴────────────────┐
                │                                │
      ┌─────────▼─────────┐          ┌───────────▼──────────┐
      │ Context Index       │          │ Task Memory          │
      │ 关键词、实体、摘要  │          │ 目标、约束、决策      │
      │ source seq、Token   │          │ 产物、错误、待办      │
      └─────────┬─────────┘          └───────────┬──────────┘
                └───────────────┬────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │ Context Router         │
                    │ 范围判断、关联度、预算  │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │ agent/request-context  │
                    │ 本次模型请求快照       │
                    └───────────────────────┘
```

### 4.1 Session Log

Session 仍然是事实来源。用户消息、模型回复、工具调用、工具结果、任务事件和上下文选择事件都进入 Session。Session 的完整历史不因为请求裁剪而丢失。

### 4.2 Context Index

Context Index 是由 Session 派生的本地索引，可以重建，不拥有新的事实。每条索引记录至少包含：

```text
ContextChunk
- id
- sessionId
- sourceSeqStart / sourceSeqEnd
- kind: task | decision | error | artifact | tool-result | summary | message
- text 或 summary
- relatedTaskId
- relatedFiles / entities
- keywords
- estimatedTokens
- importance
- createdAt
- sourceHash
```

索引必须保存原始事件序号和内容哈希。摘要过期、源事件改变或 compaction 替换表层内容时，索引可以标记失效并重新生成。

### 4.3 Task Memory

任务记忆不是一段大 prompt，而是小型结构化状态：

```text
TaskMemory
- taskId
- goal
- constraints
- decisions
- completedItems
- unresolvedItems
- artifacts
- activeFiles
- latestErrors
- acceptanceCriteria
- sourceSeqs
- updatedAt
```

Task Memory 始终保持短小。它负责保证任务连续性，不负责保存全部工具输出。原始工具输出通过 `sourceSeqs` 回指 Session 或 Context Index。

## 五、上下文范围模型

每次请求需要一个明确的 `contextScope`：

| 范围 | 说明 | 默认场景 |
| --- | --- | --- |
| `fresh` | 系统提示词、当前请求、必要权限事实 | 新话题、普通问答 |
| `task` | 当前任务记忆、最近相关轮次、少量召回证据 | 长任务继续执行 |
| `recent` | 最近若干轮和当前任务记忆 | 连续追问 |
| `full` | 尽可能完整的当前表层历史 | 用户明确要求回顾全文、兼容模式 |

第一阶段建议默认使用 `task`，但当系统识别到明确的新话题时切换为 `fresh`。如果用户选择“新话题”，必须直接使用 `fresh`，不能由模型自行否定用户选择。

### 5.1 范围选择优先级

```text
用户显式选择
  > 显式引用当前任务
  > 当前任务是否仍在运行
  > 文件、错误、实体关联
  > 关键词与语义相似度
  > 最近性
```

明确的新话题信号必须能够压低历史关联度，例如“换个问题”“先不管刚才的事”“新话题”。

## 六、关联度判断

关联度不能只依赖 embedding。向量相似度适合召回候选，不适合决定权限、任务约束或审批事实。

### 6.1 关联信号

| 信号 | 示例 | 权重建议 |
| --- | --- | ---: |
| 显式引用 | “继续刚才的任务” | 最高 |
| 活动任务 | 当前任务仍处于 running | 高 |
| 文件实体 | `orders.json`、`analyze.mjs` | 高 |
| 错误实体 | `CONTEXT_WINDOW_EXCEEDED`、测试名称 | 高 |
| 关键词匹配 | “分类金额统计” | 中 |
| 语义相似 | 语义接近但没有精确实体 | 中低 |
| 时间接近 | 最近几轮 | 低 |
| 新话题信号 | “顺便问一下天气” | 负权重 |

### 6.2 候选评分

候选评分可以先使用可解释的离散分数：

```text
score = explicitReference
      + activeTask
      + entityMatch
      + keywordMatch
      + semanticSimilarity
      + recency
      - newTopicPenalty
      - tokenCostPenalty
```

第一阶段不要求评分具备机器学习意义，只要求：分数来源可解释、排序稳定、测试可以固定。

### 6.3 召回结果分类

召回结果分为三类：

1. **必须保留**：系统提示词、当前用户请求、活动任务约束、审批事实、工具调用与结果配对。
2. **优先保留**：当前任务摘要、最新错误、活动文件、未完成事项、最近决策。
3. **预算允许时保留**：相关旧消息、相似工具结果、历史讨论和低优先级背景。

预算不足时只能从第三类开始裁剪，不能静默删除第一类内容。

## 七、请求组装流程

每次模型请求建议执行以下顺序：

1. 读取当前用户消息和当前 Agent 的模式策略。
2. 解析显式范围选择或用户的“新话题 / 继续任务”意图。
3. 读取当前活动任务的 Task Memory。
4. 从 Context Index 生成候选片段。
5. 使用关键词、实体、任务关系和语义相似度排序。
6. 预留 system prompt、工具 schema 和输出 Token。
7. 先加入必须保留内容，再按分数加入优先内容和候选证据。
8. 对工具调用与工具结果执行原子配对检查。
9. 生成 `context/selection` 事件，记录选择结果和裁剪原因。
10. 将最终消息传给 `agent/request-context` 下游。

伪代码：

```ts
async function buildRequestContext(input: RequestContextInput): Promise<Message[]> {
  const scope = resolveScope(input.userMessage, input.explicitScope, input.task)
  const required = collectRequiredContext(input)
  const candidates = await contextIndex.search({
    sessionId: input.session.id,
    taskId: input.task?.id,
    query: input.userMessage,
    scope,
  })
  const ranked = rankCandidates(candidates, input.userMessage, input.task)
  const selected = packWithinBudget({
    required,
    ranked,
    systemPromptTokens: input.systemPromptTokens,
    toolSchemaTokens: input.toolSchemaTokens,
    outputReserveTokens: input.outputReserveTokens,
    maxContextTokens: input.maxContextTokens,
  })
  recordContextSelection(input.session, selected)
  return selected.messages
}
```

## 八、预算模型

当前 `maxContextTokens` 主要限制消息历史。改造后需要把完整请求预算拆开：

```text
总上下文预算
- system prompt
- tool schema
- output reserve
- 当前用户请求
= 历史、Task Memory、知识库和工具结果的可用预算
```

建议审计字段增加：

```text
contextScope
contextReason
selectedChunkIds
selectedSourceSeqs
requiredTokens
retrievedTokens
droppedByReason
relationScores
```

估算值仍然只是本地解释值，不能冒充提供方账单。真实 usage 继续由 Token Meter 记录。

## 九、持久化与回放要求

DSH 的规则是“模型可见即已记录”。因此，检索出的上下文不能只存在内存缓存中。

建议新增一个可忽略但可回放的事件：

```text
context/selection
- turn
- step
- scope
- reason
- selectedChunkIds
- selectedSourceSeqs
- droppedChunkIds
- estimatedTokens
```

Context Index 可以在本地存储中异步生成和重建，但请求真正使用的选择结果必须能够通过 Session 事件解释。重启后优先使用已记录的选择；索引缺失时按源事件重建，不应静默退回完整历史。

对于摘要，必须保存源事件范围和版本。摘要生成失败时，系统可以继续使用最近原文，但不能写入一个没有来源的“事实摘要”。

## 十、与现有代码的集成点

### 10.1 Agent Loop

不修改主循环的状态机，只继续使用 `agent/request-context`。如果需要暴露新的请求输入，应扩展事件 payload 或新增请求上下文服务，避免把检索逻辑写进 `agent.ts`。

### 10.2 Personal Agent

将 [`limitContext()`](../packages/interaction/personal-agent/src/index.ts) 中的通用逻辑拆出：

- 工具结果裁剪和工具调用配对可以继续作为通用预算组件；
- `historyTurns` 兼容旧模式，但不再是唯一的历史策略；
- `contextScope` 和 Context Router 应独立于个人模式；
- Personal Agent 只负责模式策略、权限和模式级预算。

### 10.3 Diaosi Preset

`diaosi` 保留按需工具发现、结果上限和 compaction。新增 Context Router 后：

- 工具 schema 仍由 tool discovery 控制；
- 历史消息由 Context Router 控制；
- compaction 仍负责上下文接近模型上限时的压缩；
- 三者都记录各自原因，避免把工具裁剪、历史裁剪和摘要压缩混为一个数字。

### 10.4 Knowledge Base

知识库和会话记忆必须分层：

- Knowledge Base：外部或项目资料，按知识库选择和检索；
- Task Memory：当前任务的状态和决策；
- Session Context Index：当前会话曾经发生的事实。

知识库召回不应替代当前任务状态，也不应把整个会话复制到知识库。

### 10.5 Token Meter 和轨迹

Token Meter 继续负责提供方 usage 和请求压力。Token 轨迹增加上下文来源视图，至少显示：

- 当前 scope；
- 当前任务摘要占用；
- 历史召回占用；
- 工具结果占用；
- 因预算被丢弃的内容类型；
- 本次召回的源事件范围。

当前 Web Token 轨迹已先提供一个只读的上下文预览：按最新模型请求将系统提示词、用户消息、历史模型输出、工具结果和工具定义绘制成分段图，并列出每段来源、序号和估算 Token。它复用现有 Session 事件流，不改变请求；等 Context Router 接入后，预览需要改为优先读取 `context/selection` 的实际选择结果，并对“完整表层历史”和“本次模型可见快照”分别标识。

## 十一、分阶段实施计划

### 阶段 0：建立基线

**目标**：先测量现状，避免改造后只凭感觉判断。

**任务**：

1. 记录同一 Session 中“继续任务”和“无关简单问题”的实际输入 Token。
2. 区分 system、tool schema、history、tool result、skill、knowledge 的占比。
3. 记录 diaosi、minimal、standard 三种模式的同一测试样本。
4. 确认已有 `agent/request-context` 审计在默认 diaosi 会话中的覆盖范围。

**产物**：基线测试、Token ledger 样本、问题复现用例。

已加入 [`apps/cli/tests/web-agent-presets.e2e.ts`](../apps/cli/tests/web-agent-presets.e2e.ts) 的无 API Key 确定性测试：构造 20 个已完成历史轮次，使用默认 `diaosi` preset，分别发送“今天天气怎么样？”和“继续刚才的旧任务。”。测试同时记录请求消息数量、JSON 字符数、固定估算输入 Token、system/history/tool-result 拆分、旧任务消息数和 compaction 是否发生。

当前基线样本（快照位于 [`apps/cli/tests/__snapshots__/web-agent-presets.e2e.ts.snap`](../apps/cli/tests/__snapshots__/web-agent-presets.e2e.ts.snap)）：

| 场景 | 消息数 | 请求 JSON 字符数 | 固定估算输入 Token | 旧任务消息数 | compaction |
| --- | ---: | ---: | ---: | ---: | --- |
| 无关问题 | 44 | 227,570 | 55,273 | 40 | 未触发 |
| 继续任务 | 44 | 227,572 | 55,274 | 40 | 未触发 |

两个场景只在当前用户问题文本上有差异，均携带完整旧任务历史；其中 43 条为非 system 历史消息、1 条为 system 消息、0 条为 tool result。该数据确认了“简单无关问题仍发送约 55K 输入 Token”的现状，也确认仅依赖当前 `diaosi` compaction 配置不能解决关联度问题。

复现命令：

```bash
pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-agent-presets.e2e.ts -t 'long-session baseline'
```

**验收**：能够回答“一个 50K Session 的简单问题到底携带了多少内容”。

### 阶段 1：上下文范围 MVP

**目标**：不使用 embedding，先解决新问题误带长历史。

**任务**：

1. 新增 `fresh/task/recent/full` 四种范围。
2. 新增 Session 级 `context/scope` 事件和 projection。
3. 支持用户显式切换“新话题”和“继续任务”。
4. 将 Context Router 接入 `agent/request-context`。
5. 默认 `task`，识别明确新话题时使用 `fresh`。
6. 复用现有工具配对、当前用户消息保留和系统消息保留逻辑。

**建议文件**：

```text
packages/context/conversation-context/
packages/core/session/src/known-event-types.ts
packages/core/agent/src/runtime-types.ts
packages/interaction/personal-agent/src/index.ts
packages/preset/agent-presets/presets/diaosi/agent.cordis.yml
```

**验收**：

- 无关问题不会带入旧工具结果；
- 继续任务仍保留活动任务和最近相关内容；
- 工具调用与工具结果不会被拆开；
- Session 原始历史不变；
- 新旧 preset 都有明确的上下文策略。

**估算**：3～5 个工作日。

### 阶段 2：任务记忆与结构化摘要

**目标**：让长任务不依赖完整原文也能继续。

**任务**：

1. 为 Task Memory 定义结构和 projection。
2. 从已有 `task/*`、文件、错误和工具事件派生初始状态。
3. 在 turn 完成或关键步骤后更新任务摘要。
4. 保存摘要对应的 source seq 范围和 source hash。
5. 摘要生成失败时回退到最近原文，不写入无来源摘要。
6. 将 Task Memory 控制在固定 Token 上限内。

**验收**：

- 任务经过多次压缩后仍能恢复目标、约束、产物和未完成项；
- 摘要可以定位到原始事件；
- 摘要过期时可以重建；
- 摘要不会覆盖用户最新约束。

**估算**：4～7 个工作日。

### 阶段 3：混合召回

**目标**：按文件、错误和语义关联召回历史证据。

**任务**：

1. 增加 Session Context Index 的关键词和实体索引。
2. 接入文件名、错误码、命令名和任务名识别。
3. 增加可选本地 embedding 索引。
4. 统一关键词、实体、语义和最近性排序。
5. 为每个召回片段输出可解释原因和分数。
6. 设定召回数量、片段大小和 Token 预算。

**验收**：

- 精确文件名和错误码优先于泛化相似度；
- 语义召回不会覆盖用户显式的新话题选择；
- 召回结果可以从 source seq 复原；
- 召回失败不导致整个请求失败。

**估算**：5～10 个工作日。

### 阶段 4：产品化与评估

**目标**：让用户知道模型本次带了哪些上下文，并能修正自动判断。

**任务**：

1. 输入栏增加“新话题 / 继续任务”控制。
2. Token 轨迹增加上下文来源和裁剪理由。
3. 支持用户查看、固定和取消某条上下文。
4. 采集召回命中、用户纠正、上下文溢出和任务完成率。
5. 用固定任务集比较不同策略的 Token、耗时和完成率。

**验收**：

- 用户可以在不查看原始日志的情况下理解上下文来源；
- 用户选择优先于自动关联度；
- 自动召回错误可人工纠正；
- 不引入不可解释的 Token 增长。

**估算**：3～5 个工作日。

## 十二、测试计划

### 12.1 单元测试

覆盖以下行为：

1. `fresh` 不保留旧历史。
2. `task` 保留任务记忆和当前活动文件。
3. `recent` 按轮次边界保留消息。
4. `full` 保持兼容模式行为。
5. 当前用户消息和系统消息始终保留。
6. 工具调用和工具结果必须成对保留。
7. 新话题信号覆盖低分历史召回。
8. 文件名、错误码和任务名优先召回。
9. 预算不足时按优先级裁剪。
10. source seq 缺失或索引过期时能够重建。

### 12.2 组合测试

通过真实 Cordis 组合验证：

- `diaosi` preset；
- `minimal` preset；
- `standard` preset；
- Personal Agent 管理会话；
- 旧 preset unmanaged 会话；
- Knowledge Base 已启用和未启用；
- compaction 前后；
- Session 重启和回放。

### 12.3 端到端测试

至少加入三个固定场景：

1. 50K 长任务后提出无关问题，验证请求上下文显著变小。
2. 长任务中继续修改同一个文件，验证相关历史仍然存在。
3. 用户明确选择“新话题”后，模型请求不携带旧任务摘要之外的历史。

测试不能只检查最终回答，还要检查实际模型请求中的消息、工具 schema、selection 事件和 Token ledger。

## 十三、指标与成功标准

### 13.1 成本指标

1. 无关问题的平均输入 Token。
2. 继续任务的平均输入 Token。
3. `contextScope` 各类型的使用比例。
4. 历史召回 Token 占比。
5. 上下文溢出次数。
6. compaction 次数和 compaction 辅助请求次数。

### 13.2 质量指标

1. 任务继续成功率。
2. 关键约束丢失率。
3. 工具调用错误率。
4. 用户手动切换上下文范围的比例。
5. 召回后仍需用户重复说明的比例。

### 13.3 第一阶段建议目标

这些是验收目标，不是已经测得的结果：

- 无关简单问题不再携带旧任务工具结果；
- 无关问题的历史 Token 占比接近零；
- 继续任务的关键约束保留率达到 100%；
- 不增加工具调用和模型步骤；
- 旧 Session 可以继续打开和回放。

## 十四、风险与回滚

### 风险一：误判新话题

**后果**：无关问题携带旧任务，继续浪费 Token。

**处理**：默认范围设置为 `task` 而不是 `full`；支持用户显式 `fresh`；记录自动判断原因。

### 风险二：误删关键约束

**后果**：模型重复犯错或修改错误文件。

**处理**：Task Memory 中的约束、审批和当前用户请求属于必须保留项；每条摘要保留 source seq；关键任务支持 `full` 兼容模式。

### 风险三：向量召回相似但错误的历史

**后果**：模型引用了其他任务的文件或决策。

**处理**：优先使用 sessionId、taskId、文件实体和错误实体过滤；embedding 只召回候选，不直接决定最终上下文。

### 风险四：索引与 Session 不一致

**后果**：重启后出现过期摘要或无法回放。

**处理**：Session 是权威事实；索引带 source hash；不一致时重建；选择结果记录在 Session。

### 风险五：上下文预算计算失真

**后果**：本地估算与提供方实际 usage 不一致。

**处理**：继续区分本地估算和提供方 usage；保留安全余量；使用 Token Meter 的真实数据校准。

### 回滚方案

上下文路由必须支持配置关闭：

```text
contextRouter.enabled = false
```

关闭后恢复现有 `agent/request-context` 逻辑，Session 原始事件、旧 preset 和 compaction 不受影响。新增加的 `context/*` 事件使用 `ignorable` 标记，旧读取器可以忽略。

## 十五、配置建议

第一阶段可以提供以下配置，不要把所有细节暴露成几十个开关：

```yaml
- id: conversation-context
  name: '@deepseek-ai/dsh-conversation-context'
  config:
    enabled: true
    defaultScope: task
    newTopicDetection: local
    taskHistoryTurns: 4
    maxTaskMemoryTokens: 1200
    maxRetrievedChunks: 6
    maxRetrievedTokens: 4000
    recordSelection: true
```

第二阶段再增加：

```yaml
    retrieval:
      keyword: true
      entity: true
      semantic: false
      localEmbedding: false
```

Embedding、索引数据库和摘要模型不应在第一阶段成为默认强依赖。

## 十六、最终建议

建议按以下顺序实施：

1. 先建立 50K 长任务的真实 Token 基线。
2. 先做 `fresh/task/recent/full` 和 Task Memory，不做 embedding。
3. 把通用上下文逻辑从 Personal Agent 中拆出，覆盖 diaosi preset。
4. 用固定的“无关问题”和“继续任务”测试验证节省与质量。
5. 指标稳定后再接入混合语义召回。

这条路线可以先用几天时间解决主要浪费，再用一到两周完善结构化记忆和召回质量，避免一开始把 DSH 改造成一个复杂的向量数据库系统。

## 十七、当前状态

本文只是实施规划，当前仓库尚未实现独立的 Context Router、Task Memory、Context Index 或 `context/selection` 事件。现有 `agent/request-context`、Personal Agent 的历史预算和 compaction 仍按当前代码运行。
