# Agent Note：游戏工作室 preset

Status: implemented

[English](2026-09-24-game-studio-preset.md) | 中文

## Problem

试玩广告生产、游戏编辑器开发和游戏工具箱维护共享一套生产工作流，但现有随附 preset 只有通用编码、节省 Token、PTC、极简和 preset 创作模式。

## Decision

新增 `game-studio` preset。它包含标准模式的组装，并覆盖面向生产的 Agent 人设，同时为三个工作轨道提供一组经过筛选的 20 个 skill。该人设要求分阶段执行、维护可恢复 checkpoint、收集后台 Job、使用规范的预览／编译／导出链路，并明确报告发布状态。这组 skill 结合工作室本地 runbook、`openai-api-curated/game-studio` 中的浏览器游戏制作 skill，以及用于游戏接入、打包、合规、本地化和 NAS 交付的 Codex 本地试玩制作 skill；仓库内置清单记录这些来源。runbook 要求试玩源资源保持不可变、编辑器特有行为放入受审查的游戏包，并在工具箱维护中保护兼容性与证据。

该 preset 作为独立的内置组装提供，而不是修改标准模式，因此普通编码会话保持现有行为，用户只需在新会话中选择游戏工作流。

## Alternatives considered

**全局修改标准模式。** 否决，因为生产门禁和发布术语会给普通编码会话增加干扰。

**只增加一段系统提示词。** 否决，因为游戏工作流需要随包交付、可加载的 runbook 和独立的可选身份，不能只依赖可能与技能脱节的说明文字。

**拆成三个独立 preset。** 第一版否决，因为三个轨道共享检查点、后台 Job 处理和证据纪律；用轨道专属 runbook 保留一个工作室入口，避免复制整套标准组装。

**加载整个本地 Codex skill 目录。** 否决，因为这样会把无关且与机器绑定的工作流带入 preset，并让发布结果依赖当前工作站。竞品研究 skill 和体积为 126 MB 的移动游戏自动化系统不属于编辑器与试玩的直接制作链，因此不内置。

## Consequences

内置选择器新增 `游戏工作室模式`／`Game Studio mode`。其组装通过 `cordis:include` 复用标准模式，并增加 20 个内置 skill，因此既能共享标准模式的能力修复，又不会依赖用户主目录中的 skill。游戏工作室会按当前阶段路由到最小必要 skill 子集，不会把所有 skill 正文一次性载入模型上下文。现有会话不变；新会话可以选择该 preset。外部平台、Checker 和设备验证仍明确由人工或外部系统负责。
