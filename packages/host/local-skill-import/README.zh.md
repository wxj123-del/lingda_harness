---
description: "在宿主侧发现并受限导入本机 Codex 与 Agents Skill。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-local-skill-import

[English](README.md) | 中文

## 概述

此宿主插件扫描 `~/.codex/skills` 与 `~/.agents/skills` 中的 `SKILL.md`，并把通过校验的候选项提供给技能广场。用户选择 Skill 后，宿主会重新读取目录，并打包成受大小限制的 ZIP，交给已有的导入确认流程。

扫描器不跟随符号链接，也不会执行导入资源中的脚本。目录深度、文件数量、解压后大小与压缩包大小均有限制。Remote 只接受最近一次扫描生成的不透明候选 ID，不接受浏览器提交任意本机路径。

## 目录

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

### 导入的 Skill 压缩包

#### 模型看到的内容

技能广场只提供通过校验的 `SKILL.md` 元数据和用户选择的有界压缩包。模型可以通过现有 Skill 界面使用导入的指令；任意本机路径和压缩包中的脚本不会直接进入模型输入。

#### Token 影响

只有 Skill 名称、说明和明确加载的指令会进入模型上下文。扫描和 ZIP 校验在本机完成，不消耗服务商 Token。

#### KV Cache 影响

加载 Skill 会改变当前请求追加的指令上下文，也可能改变后续轮次可复用的请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **仅扫描本机目录**：扫描器读取 Host 机器上配置的 Codex 和 Agents Skill 根目录，不搜索远程文件系统。
- **压缩包有界**：目录深度、文件数量、解压大小和压缩大小都是固定上限，过大的 Skill 需要先精简。
- **不执行脚本**：导入脚本和资源会保留，但导入器不会执行它们。

不发布运行时不变式配套项；每次导入都会直接根据文件系统重新校验。

<a id="dev-note"></a>
### 开发备注

Host 负责文件系统扫描和压缩包校验；技能广场和确认界面只消费生成的候选 ID。
