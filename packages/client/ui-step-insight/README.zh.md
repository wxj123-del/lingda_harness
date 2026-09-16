---
description: "可选的 Token 轨迹替换插件，提供逐次请求用量和可检查的输入来源。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-client-ui-step-insight

[English](README.md) | 中文

## 概述

这个可选浏览器插件将轨迹标签页替换为实时 Token 明细。每次已加载的模型尝试和上下文压缩都有独立记录，展示输入、输出、缓存读取、缓存写入、思考、耗时、工具调用及原始事件编号。通过更高优先级的 `trajectory` 插槽注册替换界面，卸载后恢复原视图。原轨迹插件继续作为会话目标的拥有者运行。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用方式

在仓库根目录构建，然后通过源码配置层启动 Web profile：

```sh
pnpm run build
pnpm dsh --profile web --patch ./packages/client/ui-step-insight/cordis.source.patch.yml --port 3082 --no-open
```

持久安装使用 `dsh plugin --profile web add ./packages/client/ui-step-insight` 安装已构建的目录，重启该 profile 后打开会话的 Token 轨迹标签页。执行 `dsh plugin --profile web remove @deepseek-ai/dsh-client-ui-step-insight` 并重启可恢复原视图。包通过 `dsh.bundle` 声明配置层，配置层挂载插件，宿主通过 `dsh.client` 发现已构建的浏览器入口。

明细使用现有会话事件流实时更新。搜索匹配步骤、模型、提供方和工具名；筛选支持用量缺失与中断尝试；排序依据已上报总量或已知分项小计。选择一条记录可查看计量、输入来源、输出内容、工具和原始事件。导出生成包含已加载明细与原始持久事件的 JSON。加载更早历史会扩展明细和统计范围。

### 计量口径

供应商计数是实际用量依据。输入由未缓存输入、缓存读取和缓存写入组成。思考已包含在输出内。供应商总量与已知分项一致时保留其精确总量；否则只有输入各项齐全时才计算精确合计。缺失字段显示未知。无法获得精确合计时，`≥` 仅表示已上报计数的小计。实时用量检查点替换较早样本；持久结算替换临时流内容。重试尝试与压缩请求独立保留用量。

输入来源先应用已记录的内容替换，再展示当次请求的历史前缀。系统提示词、用户和插件消息、历史输出、工具结果及每个工具定义均可检查。内容大小使用明确标注的每四个字符一个 Token 估算，独立于供应商计量。工具参数属于模型输出，工具结果可进入后续请求输入。PTC 子调用标为内部调用，不额外累计为模型消耗。

工具定义同时显示与对话的估算相似度、匹配词，以及当前步骤是否调用过该工具。默认参照保留下来的最新用户消息，也可切换为所选请求内的全部用户消息。排序可保持工具原始顺序或按相似度降序。展开参照文本或工具即可检查原文与匹配依据。评分对词项去重，使用常见中英任务词映射，对工具名称和描述计算 IDF 加权余弦相似度。系统提示词、插件消息、助手回答、工具结果、附件元数据、工具参数定义及后续消息不参与计算。没有可比较文本时保持未知；可比较文本没有匹配词时显示零。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节</summary>

客户端通过可撤销注册贡献一个更高优先级的会话视图和本地化字典。注册私有的渲染器 hook 读取现有 `SessionBinding.eventSource`，不创建额外传输订阅或宿主服务。`step-model.ts` 汇总请求尝试，`input-parts.ts` 还原选中请求的输入来源，`usage.ts` 保留计量中的未知状态。不发布 invariant 伴随插件，因为本插件只拥有派生界面，不拥有可独立变化的宿主关系。

追加事件复用请求组装状态，历史替换、分页和结算则从权威事件窗口重建。会话拥有者将插槽胜出项投影为标签页，因此替换后只显示一个标签，卸载后恢复原标签。profile 配置层插入 `ui-step-insight` 行，清单将浏览器入口限定在 Web 平台。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [会话组装](../../../docs/subsystems/conversation.zh.md) 定义视图注册与源数据。
- [Token meter](../../llm/token-meter/README.zh.md) 定义完整会话的供应商计量与上下文压力。
- [决策记录](../../../.agents/notes/implemented/feature/2026-09-16-token-trace-plugin.zh.md) 说明可选替换与精度限制。

<a id="model-experience"></a>
## 模型体验

无。本插件只在浏览器渲染已记录的会话数据，不发起模型请求。

#### KV 缓存影响

插件不修改提示词、工具、历史或提供方请求，因此保持既有请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **供应商精度：** 日志没有逐条消息的精确分词或价格。文本估算不是账单计数，不包含图像 Token、文件转换和提供方封装。流式精确用量只有在供应商返回后才出现。
- **已加载历史：** 合计仅覆盖已加载窗口，不包含未加载历史或独立子会话。标题生成等未记录会话用量的辅助调用无法计入。失败请求的缺失用量也保持未知。
- **输入还原：** 不还原插件自定义消息投影或专用压缩提示词。分页缺口明确标注，旧历史缺失的时间戳保持不可用。
- **相似度精度：** 本地词项估算不代表向量语义、模型置信度或工具调用概率。有限的词汇映射无法覆盖所有语言和改写。评分取决于当次请求的工具目录和已加载用户文本，不改变请求、不产生模型用量。
- **界面范围：** 本视图替换轨迹明细，不提供原视图专用的图形时间轴或图片画廊。原始记录和源内容仍可检查。JSON 导出包含已加载的对话内容和工具结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

[决策记录](../../../.agents/notes/implemented/feature/2026-09-16-token-trace-plugin.zh.md) 说明计量边界和浏览器回放场景。

</details>
