# Agent Note：游戏工作室运行记录

状态：已实现

[English](2026-09-25-game-studio-runtime.md) | 中文

## 问题

第一版游戏工作室模式只在提示词中描述 checkpoint、后台 Job 和发布状态，没有结构化工作区记录，也没有可以执行的发布裁决。

## 决策

将 `@deepseek-ai/dsh-tool-game-studio` 加入游戏工作室 preset。`studio_checkpoint` 把完整阶段记录写入 `.game-studio/runs/<run-id>/checkpoint.json`；`studio_release` 验证或保存报告，并根据证据计算 `READY`、`BLOCKED` 或 `NEEDS REVIEW`。Web 会话头部通过 `ui-jobs` 的游戏工作室 HUD 展示最新持久化 checkpoint，包括发布状态、阶段、交付物、下一步、阻塞项和报告路径。现有 `dsh-tool-goal` 和 `dsh-tool-jobs` 继续负责长期目标与进程内后台任务，本包只记录它们的 id 和结果，不复制这些服务。

## 备选方案

只把流程写在提示词里无法跨上下文重置恢复，也不能提供机器计算的发布裁决。若在本包复制后台任务注册表，会造成所有权分裂和状态不一致，因此运行时只记录 Job id，并读取既有的会话范围状态。

## 结果

长任务拥有可在上下文重置后读取的交接文件、发布报告和会话头部状态视图。缺少外部验证会明确得到 `NEEDS REVIEW`，检查失败或显式阻塞项会机械得到 `BLOCKED`。跨进程后台任务仍由部署决定；没有可重启产物和命令时，报告不能声称 Job 跨重启存活。HUD 只读，没有有效 checkpoint 时会隐藏。
