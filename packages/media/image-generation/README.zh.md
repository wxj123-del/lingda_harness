---
description: "通过可配置的 Provider 和模型路由生成、编辑、保存并展示图片。"
kind: "package-bundle"
---

# dsh-image-generation

[English](README.md) | 中文

## 概述

根据提示词生成图片或编辑本地参考图，并将结果保存为持久附件。配置层提供 `generate_image` 和 `list_image_models`，现有对话渲染器会展示生成的图片。修改 Provider 和模型配置即可切换订阅套餐。

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

此配置层通过 [cordis.patch.yml](cordis.patch.yml) 插入 `image-generation` 行，依赖工具、附件和凭据服务；本地参考路径还需要文件系统服务。配置一个明确的路由。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节</summary>

通用核心负责路由选择和凭据解析。Provider 适配器处理 OpenAI Images、火山引擎、DashScope/Wan 和 Gemini 请求。工具校验参考图，保存图片附件和原始文件，再返回图片和文件内容块。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [通用生成核心](../generation-core/README.zh.md) — 共享路由和用量处理。
- [语音生成](../speech-generation/README.zh.md) — 对应的音频配置层。

## Model Experience

### 生成工具

#### What the model sees

模型接收 `generate_image` 工具。结果包含所选 `provider`、`model`、`elapsedMs`、原始 `usage`、保存的图片元数据和保存的原始文件元数据。工具渲染器会为生成结果添加 `image` 块和 `file` 块。

#### Token effect

工具模式以及每次调用的提示词、可选尺寸、比例和参考图数据，会按照所选模型路由增加 Token 或图片输入。Provider 用量原样保留；缺失时为 `null`，绝不估算为零。

#### KV Cache effect

工具结果追加到对话并保留之前的请求内容。启用或移除工具会改变工具前缀。Provider 生成请求独立于智能体请求，不共享 KV 缓存。

## Known Limitations and Deferred Work

- 参考输入暂不接受已有附件 ID；每次调用只输出一张位图，暂不提供遮罩、流式预览和多图生成。

<a id="dev-note"></a>
### 开发备注

真实 Provider 访问需要相应的订阅凭据；Loader 和适配器测试使用确定性的本地 HTTP fixture。
