---
description: "媒体能力包组：共享的 Provider 路由，以及图片和语音生成 bundle。"
kind: "package-group"
---

# media/ — 媒体生成能力家族

[English](README.md) | 中文

## 概述

media 组提供可配置的图片和语音生成。`generation-core` 负责路由选择、凭据解析、有界下载和 Provider 用量记录；`image-generation` 与 `speech-generation` 提供模型可见工具和持久附件。每个包的 README 负责自己的配置与 Provider 约定。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`generation-core/`](generation-core/README.zh.md) | 共享媒体路由、凭据、有界传输和用量记录 | library |
| [`image-generation/`](image-generation/README.zh.md) | 生成和编辑图片，并保存图片与源文件附件 | 注册模型工具 |
| [`speech-generation/`](speech-generation/README.zh.md) | 生成语音，并保存音频文件附件 | 注册模型工具 |

<a id="related-documentation"></a>
## 相关文档

- [图片生成包](image-generation/README.zh.md) — 图片 Provider 与 `generate_image`。
- [语音生成包](speech-generation/README.zh.md) — 语音 Provider 与 `generate_speech`。
- [附件包](../attachment/README.zh.md) — bundle 返回的持久文件和图片引用。

<a id="dev-note"></a>
## 开发备注

Provider 测试使用确定性的本地 HTTP fixture；实时生成需要所选 Provider 的凭据。
