---
description: "由宿主负责的多知识库检索，支持知识编辑、可配置文本切分、本地中文向量模型、LanceDB 持久化和面向智能体的检索工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-knowledge

[English](README.md) | 中文

## 概述

这个 Host 插件提供 `knowledge` 本地多知识库能力。知识库元数据、知识内容、版本和索引清单保存在同一个数据目录中，片段向量保存在 LanceDB 中。Web 编辑页面通过 `knowledge/*` Remote 使用它，智能体通过 `knowledge_list` 和 `knowledge_search` 使用它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

Web bundle 会自动挂载这个包。每个知识库包含名称、说明、启用状态、知识内容和切分设置。保存后会在后台建立索引。页面可以在保存前预览递归、Markdown 或固定长度切分，也可以执行检索测试，查看原文片段和余弦相似度。

默认向量模型是 `Xenova/bge-small-zh-v1.5`，通过 `@huggingface/transformers` 使用 CPU ONNX 推理，并按需加载。第一次建立索引或检索时会把模型下载到知识库数据目录。如果设置不是文件存储，可以配置 `dataDirectory`；其他模型、大小、批次和限制字段都是经过校验的 Host 配置。

<a id="understand-the-implementation"></a>
## 理解实现

`src/index.ts` 负责清单、乐观版本、原子写入、过期索引拒绝、后台重建和 LanceDB 表轮换。`src/split.ts` 保证预览和建索引使用同一套切分逻辑。`src/embedding.ts` 负责按需加载模型和可重试的失败。`src/tools.ts` 注册智能体工具。每次检索都会先应用可配置的余弦相似度阈值、正文去重、结果数量限制和估算 Token 上限，再返回知识库、文档、片段序号、原文片段和相似度；尚未完成索引的知识库会列在 `skippedBases` 中。

Web 页面首次打开时会导入旧的 `ui-authoring.knowledge` 记录。旧设置区会保留，导入内容复制到新清单中，因此迁移不会改写原设置文件。

<a id="model-experience"></a>
## 模型体验

### 对话中的自动检索

#### 模型看到的内容

输入栏会把选中的知识库 ID 保存在当前 Session。下一条用户消息发送给模型前，Host 会检索这些知识库，并加入带有知识库、文档、相似度和索引状态的来源片段。没有选择时不会自动检索。

#### Token 影响

切分、建索引和向量化都在本机完成。只有在模型请求中加入结果片段或 `knowledge_search` 工具说明时，才会消耗上下文 Token。

#### KV Cache 影响

选中的知识库上下文通过现有请求组装追加，因此改变选择可能改变后续轮次可复用的请求前缀。

### 显式知识工具

#### 模型看到的内容

模型可以调用 `knowledge_list` 查看启用的知识库，并调用 `knowledge_search` 检索有界的原文片段。工具返回知识库和文档归属，不暴露本机索引路径。

#### Token 影响

工具 schema 和返回片段会消耗服务商上下文 Token。LanceDB 查询和向量化在本机完成，不消耗服务商生成 Token。

#### KV Cache 影响

显式工具调用是普通追加的工具轮次，遵循现有请求组装和缓存行为。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **需要下载本地模型**：首次使用需要网络下载模型文件；下载失败后可以重试，页面会显示模型状态。
- **按字符限制**：切分大小和重叠长度按字符计算，不是按 tokenizer Token 计算。后续可以增加 tokenizer 感知模式，使成本估算更精确。
- **本机单进程持有**：LanceDB 由 Host 进程打开，同一个数据目录预期同时只有一个 DSH 进程使用。
- **当前 Session 独立选择**：选择会写入 Session 日志，恢复会话或从会话创建分支时可以重建；知识库被停用时不会参与自动检索。

不会发布 runtime invariant companion，因为本包的持久化契约是知识库清单和索引文档。

<a id="dev-note"></a>
### 开发备注

这是一个 Host service，Typert 会生成 `./typert` 和 `./remote` 两个接口。它由 `dsh-web-app` 挂载，Remote 组装由 `dsh-api-remotes` 负责。删除接口使用 `knowledge/deleteBase`，因为 `remove` 是 Client 命名空间服务的保留方法。至少启用一个知识库时才注册检索工具；最后一个启用的知识库被停用或删除后，工具随之移除。
