---
description: "对话驱动的创作助手：从一次聊天中起草可视化工作流与私有知识库。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-authoring-assistant

[English](README.md) | 中文

## 概述

这个 Host 插件提供 `authoringAssistant`，为 Web 创作界面提供对话式起草服务。一轮对话变成一次辅助模型请求，返回结构化的 workflow 草稿或知识库草稿。起草过程不写入任何 Session event：是否保存由浏览器通过现有的 workflow 与 knowledge Remote 决定。

## 目录

- [使用](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用

Web bundle 把本包与工作流控制台、知识库面板一起挂载。对外暴露两个 Remote：

| Remote | 作用 |
|---|---|
| `generateWorkflow` | 把一条用户消息、历史轮次和当前草稿变成校验过的可视化工作流图。 |
| `generateKnowledge` | 把一条用户消息变成知识库草稿，可先抓取来源 URL。 |

两个 Remote 都从插件配置（`provider` 与 `model`）解析模型，缺省时回落到部署默认模型。每轮请求都带独立的取消信号。模型回复里没有可用 JSON 时仍返回其文字，让对话可以继续。

`generateKnowledge` 通过 `ctx.web` 最多抓取 8 个绝对 HTTP(S) URL。每个页面先转成纯文本，单页截断到 12,000 字符，每轮合计上限 48,000 字符。抓取到的内容属于不可信输入：脚本、样式和注释在进入模型前已剥离，提示词也禁止编造来源 URL 或断言。

<a id="understand-the-implementation"></a>
## 实现说明

`src/draft.ts` 负责校验模型输出：强制唯一的 start 与 end 节点、tool 与 HTTP 节点的必填配置、edge 索引边界以及去重。校验失败的 edge 会被丢弃而不是让整份草稿失败，因此大体正确的提案仍然可编辑。`src/prompts.ts` 拥有两套 system prompt 以及有界的历史与草稿渲染。`src/text.ts` 负责 HTML 转纯文本。

本服务不注册任何面向模型的工具或提示词段落，草稿结构只通过 Remote 结果到达浏览器。

<a id="model-experience"></a>
## 模型体验

### 工作流与知识库起草

#### 模型看到什么

每轮是一次 system prompt 加一条用户消息，消息内含近期对话记录、以 JSON 表示的当前草稿、已抓取的资料原文以及本次请求。system prompt 固定 JSON 结构与图结构规则；助手历史轮次作为文本回放，不作为工具结果。

#### Token 影响

起草消耗 provider token，用于组合后的输入与返回的草稿。历史限制为最近 12 轮，抓取资料受字符预算约束，请求超过 128 KiB 直接拒绝。保存后的知识库分词与索引在 knowledge 包内完成，不在这里。

#### KV Cache 影响

每轮使用同一 system prompt，因此同一会话内重复起草可复用提示词前缀。修改当前草稿只改变用户消息。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **起草阶段不检索** —— 助手只依据对话和显式提供的 URL 起草，不会自动搜索网页。
- **仅生成草稿** —— 本服务从不保存、发布或索引；被拒绝或未保存的草稿不产生任何效果。
- **单一模型路由** —— 两个 Remote 共用一个配置或默认模型，尚未实现按草稿选择模型。
- **无流式输出** —— Remote 返回完整草稿，长内容没有逐字进度。

本包不发布运行时不变式伴随模块；除读取部署默认模型外，它不持有持久状态。

<a id="dev-note"></a>
### 开发备注

草稿校验放在本包，因为模型输出属于不可信输入。保存仍由 `dsh-client-ui-layout` 与 `dsh-host-knowledge` 各自的 Remote 负责，本包不扩大它们的持久化契约。
