---
description: "通过可配置的 Provider 路由生成语音并保存为持久音频文件。"
kind: "package-bundle"
---

# dsh-speech-generation

[English](README.md) | 中文

## 概述

将文本转换为语音并保存为可下载的持久附件。配置层提供 `generate_speech` 和 `list_speech_models`，支持配置 Provider、音色、格式和语速。修改 Provider 和模型即可切换套餐。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

此配置层通过 [cordis.patch.yml](cordis.patch.yml) 插入 `speech-generation` 行，依赖工具、附件和凭据服务。配置一个明确的路由。Token Plan 的 DashScope 兼容 TTS 接口使用 `api: dashscope-tts`，基础地址应指向 `/api/v1`。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节</summary>

通用核心负责路由选择和凭据解析。Provider 适配器处理 OpenAI Speech、DashScope、Token Plan DashScope TTS 和 Gemini 响应。工具校验输出格式，将音频保存为文件附件，再返回文件内容块。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [通用生成核心](../generation-core/README.zh.md) — 共享路由和用量处理。
- [图片生成](../image-generation/README.zh.md) — 对应的图片配置层。

`@deepseek-ai/dsh-speech-generation` 提供可配置的 OpenAI Speech、DashScope、Gemini 和 OpenAI 兼容适配器，并暴露 `generate_speech`。生成的字节会保存为持久文件附件并返回文件内容块。

## Model Experience

### 生成工具

#### What the model sees

模型接收 `generate_speech` 工具。结果包含所选 `provider`、`model`、`elapsedMs`、原始 `usage` 和保存的音频文件引用。工具渲染器会为生成结果添加 `file` 块。

#### Token effect

工具模式以及每次调用的文本、音色、格式、语速和指令，会按照所选模型路由增加 Token。Provider 用量原样保留；仅返回二进制的响应将 `usage` 保留为 `null`。

#### KV Cache effect

工具结果追加到对话并保留之前的请求内容。启用或移除工具会改变工具前缀。Provider 语音请求独立于智能体请求，不共享 KV 缓存。

## Known Limitations and Deferred Work

- 当前内容类型没有 audio 块。结果是可下载的文件附件，暂不提供内嵌播放、流式音频和声音克隆。

<a id="dev-note"></a>
### 开发备注

真实 Provider 访问需要相应的订阅凭据；Loader 和适配器测试使用确定性的本地 HTTP fixture。
