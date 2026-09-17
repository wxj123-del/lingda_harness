---
description: "在原生工具预设中配置按调用频次排序、按需加载的工具发现，并检查预算与回放行为。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-discovery

[English](README.md) | 中文

## 概述

在请求中保留少量高频工具，需要其他能力时再发现并加载。适用于继承了大量工具的原生工具预设。搜索只加载少量相关工具，不返回完整目录。发现工具可能增加一轮模型请求，改变已加载工具时也可能降低提示词缓存复用率。其他预设与执行权限保持不变。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在具有 `tools`、`systemPrompt` 和 `sessionQuery` 的原生工具预设内挂载。所有预算都显式配置；[屌丝模式](../agent-presets/presets/diaosi/agent.cordis.yml)使用：

```yaml
- id: tool-discovery
  name: '@deepseek-ai/dsh-tool-discovery'
  config:
    initialTools: 4
    maxTools: 8
    pinnedTools: [read, skill]
    fallbackTools: [bash, pwsh, grep, glob, edit, write]
    historySessions: 50
    searchLimit: 2
    descriptionChars: 160
    resultMaxBytes: 2048
```

`initialTools` 与 `maxTools` 包含已注册的固定工具，不含 `tool_search`。初始选择根据最近创建的 `historySessions` 个其他会话及当前会话中的实际直接调用次数排序，不重复计入分支继承的次数。仅展示工具不会提高优先级。同频次与无历史记录时使用 `fallbackTools` 顺序，其次按名称排序。每个智能体初始化只读取一次历史，之后由已提交的本地事件更新状态。无法读取的历史会话会记录并跳过。取消会终止当次装配，之后可以重试。

完整名称搜索只加载对应工具。关键词查询要求每个词都匹配名称或描述，优先按相关性、其次按频次排序，最多加载 `searchLimit` 个结果。描述受 `descriptionChars` 限制，完整渲染后的 JSON 受 `resultMaxBytes` 限制。只有成功提交结果后，工具才会出现在下一次请求中。达到容量上限时，最近最少使用的非固定项退出目录。保留的 schema 维持规范顺序。缺失或被拒绝的固定工具不会被强行开放。

-----

<a id="understand-the-implementation"></a>
## 理解实现

作用域内的装配 waterfall（瀑布式事件）在下游贡献方完成后筛选 schema，并去掉隐藏工具对应的 `tool:<name>` 指令。继承的图片、语音与 MCP 工具只有在调用方作用域内可见时才参与。工具注册仍受现有权限限制与审批检查约束并可执行：这是 schema 选择，并非授权策略。

选择状态由 `request/header`、关联的 `tool/call` 和成功的 `tool/result` 元数据回放。`meta.toolDiscovery` 记录加载名称；失败或未提交的结果不会激活工具。现有日志事件可重建模型请求，不新增事件类型或格式迁移。压缩会保留这份原始日志状态。释放插件会移除工具与监听器，并取消尚未完成的读取。

不发布 invariant companion（不变量伴随插件），因为选择状态只是权威会话日志的可释放归约，没有独立发布的数据存储需要对账。参见[实现](src/index.ts)与[行为测试](tests/discovery.spec.ts)。

-----

<a id="further-exploration"></a>
## 进一步探索

- [Agent 预设](../agent-presets/README.zh.md) — 选择组装。
- [工具](../../core/tools/README.zh.md) — 作用域可见性与执行权限。
- [会话查询](../../session-query/session-query/README.zh.md) — 实时与持久化观察。

-----

<a id="model-experience"></a>
## 模型体验

### 所选 schema 与发现结果

#### 模型看到什么

[生成的 schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-discovery)定义 `tool_search`。其他入选工具保留原始 schema。结果包含匹配名称、有界描述，以及工具会在下一次请求可用或查询没有匹配项的提示。只省略隐藏工具对应的 `tool:<name>` 段落。

#### Token 影响

初始请求最多包含 `initialTools + 1` 个 schema，后续请求最多包含 `maxTools + 1` 个。schema 自身大小没有上限。发现工具会添加有界结果，通常还会增加一次模型请求。输入缓存与已有历史意味着无法保证计费或总 Token 的固定降幅。

#### KV Cache 影响

没有发现、移除或策略变更时，目录保持稳定。加载或淘汰工具会替换 schema，可能使可复用的前缀失效。恢复会话保留已记录的选择，不会回到完整目录。提供方缓存是否可用不由本插件决定。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 采用英文关键词或完整名称进行词法搜索，未实现中文语义检索。
- 频次包含有界样本中失败的直接调用，不包含 PTC 内部调用，也不会持续刷新全局排名；不支持 PTC 展示模式。
- Skill 目录、通用指令、先前工具输出和对话历史仍需各自的预算。仅隐藏可单独归属到工具的指令。
- 已挂载的预设代次保留其配置。新对话使用更新后的随附预设；已产生的历史 Token 费用无法减少。

<a id="dev-note"></a>
### 开发备注

无。
