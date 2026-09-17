---
description: "由宿主负责的多知识库检索，支持知识编辑、可配置文本切分、本地中文向量模型、LanceDB 持久化和面向智能体的检索工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-knowledge

[English](README.md) | 中文

## 概述

这个 Host 插件提供 `knowledge` 本地多知识库能力。知识库元数据、知识内容、版本和索引清单保存在同一个数据目录中，片段向量保存在 LanceDB 中。Web 编辑页面通过 `knowledge/*` Remote 使用它，智能体通过 `knowledge_list` 和 `knowledge_search` 使用它。

## 使用本包

Web bundle 会自动挂载这个包。每个知识库包含名称、说明、启用状态、知识内容和切分设置。保存后会在后台建立索引。页面可以在保存前预览递归、Markdown 或固定长度切分，也可以执行检索测试，查看原文片段和余弦相似度。

默认向量模型是 `Xenova/bge-small-zh-v1.5`，通过 `@huggingface/transformers` 使用 CPU ONNX 推理，并按需加载。第一次建立索引或检索时会把模型下载到知识库数据目录。如果设置不是文件存储，可以配置 `dataDirectory`；其他模型、大小、批次和限制字段都是经过校验的 Host 配置。

## 理解实现

`src/index.ts` 负责清单、乐观版本、原子写入、过期索引拒绝、后台重建和 LanceDB 表轮换。`src/split.ts` 保证预览和建索引使用同一套切分逻辑。`src/embedding.ts` 负责按需加载模型和可重试的失败。`src/tools.ts` 注册智能体工具。每次成功检索返回知识库、文档、片段序号、原文片段和余弦相似度；尚未完成索引的知识库会列在 `skippedBases` 中。

Web 页面首次打开时会导入旧的 `ui-authoring.knowledge` 记录。旧设置区会保留，导入内容复制到新清单中，因此迁移不会改写原设置文件。

## 模型体验

`knowledge_list` 和 `knowledge_search` 是模型可见工具。只有智能体调用检索工具后，检索结果才会作为工具结果进入下一次模型上下文。切分、建索引和向量化都在本机完成，不消耗服务商 Token；工具说明和返回的原文片段在发送给模型时会消耗上下文 Token。

#### KV Cache 影响

这个插件不改变模型缓存策略。检索结果是普通工具输出，遵循现有请求组装和缓存行为。

## 已知限制与延期工作

- **需要下载本地模型**：首次使用需要网络下载模型文件；下载失败后可以重试，页面会显示模型状态。
- **按字符限制**：切分大小和重叠长度按字符计算，不是按 tokenizer Token 计算。后续可以增加 tokenizer 感知模式，使成本估算更精确。
- **本机单进程持有**：LanceDB 由 Host 进程打开，同一个数据目录预期同时只有一个 DSH 进程使用。
- **没有自动推送订阅**：页面打开时会刷新概览，其他客户端需要主动请求新的概览。

## 开发说明

这是一个 Host service，Typert 会生成 `./typert` 和 `./remote` 两个接口。它由 `dsh-web-app` 挂载，Remote 组装由 `dsh-api-remotes` 负责。删除接口使用 `knowledge/deleteBase`，因为 `remove` 是 Client 命名空间服务的保留方法。至少启用一个知识库时才注册检索工具；最后一个启用的知识库被停用或删除后，工具随之移除。
