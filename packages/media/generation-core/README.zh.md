---
description: "为图片和语音生成 Provider 提供共享配置与有界传输。"
kind: "package-reference"
---

# @deepseek-ai/dsh-generation-core

[English](README.md) | 中文

## 概述

使用此库校验媒体 Provider 配置，选择一个声明过的模型路由，逐次解析凭据并限制 Provider 响应。图片和语音插件使用它；它本身不注册 Cordis 插件接口。

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

从包入口导入共享配置模式和路由工具。`selectRoute` 会拒绝零个或多个匹配结果。`transport` 解析当前凭据，拒绝不安全端点和重定向，并限制响应字节数。Provider 未报告用量时保留为 `null`。

结果位于 API 源站之外时，在 `providers.<id>.downloadHosts` 中填写提供方文档确认的完整 CDN 主机名。下载请求不携带 API 凭据。未受信任主机的报错会指出 Provider 和主机名，不暴露结果路径或签名查询参数；核实主机名后，将其加入该 Provider 的配置。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节</summary>

核心负责配置校验、路由选择、有界读取、可信结果下载、取消和原始用量。协议适配器保留在图片和语音包中，使 Provider 变化保持隔离。不提供 invariant companion，因为此库不维护可能与会话记录分歧的派生状态。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [图片生成](../image-generation/README.zh.md) — 图片适配器和 `generate_image` 工具。
- [语音生成](../speech-generation/README.zh.md) — 语音适配器和 `generate_speech` 工具。

图片和语音生成插件共用的运行时核心。它校验套餐配置，选择一个声明过的 Provider/模型路由，逐次解析密钥，限制响应大小，拒绝不安全重定向，并保留 Provider 上报的用量，不虚构 Token 数。

## Model Experience

None, as 共享媒体配置和 HTTP 工具不会注册提示词、工具或会话事件。

#### KV Cache effect

没有直接影响；只有所属的生成工具调用时，Provider 选择和传输才会运行。

## Known Limitations and Deferred Work

- 具体协议仍由图片和语音包分别负责，以隔离不同 Provider 的 API 差异。

<a id="dev-note"></a>
### 开发备注

无。
