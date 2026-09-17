---
description: "在宿主侧发现并受限导入本机 Codex 与 Agents Skill。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-local-skill-import

[English](README.md) | 中文

## 概述

此宿主插件扫描 `~/.codex/skills` 与 `~/.agents/skills` 中的 `SKILL.md`，
并把通过校验的候选项提供给技能广场。用户选择 Skill 后，宿主会重新读取
目录，并打包成受大小限制的 ZIP，交给已有的导入确认流程。

扫描器不跟随符号链接，也不会执行导入资源中的脚本。目录深度、文件数量、
解压后大小与压缩包大小均有限制。Remote 只接受最近一次扫描生成的不透明
候选 ID，不接受浏览器提交任意本机路径。

不发布运行时不变式配套项；每次导入都会直接根据文件系统重新校验。
