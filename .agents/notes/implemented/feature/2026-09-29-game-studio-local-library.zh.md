# Agent Note：本地游戏工作室来源清单

Status: implemented

[English](2026-09-29-game-studio-local-library.md) | 中文

## Problem

游戏工作室 preset 只知道一个 canonical 编辑器 Demo 和项目级运行记录，无法在不复制或执行源文件的情况下检索操作者已有的编辑器项目、试玩包和素材目录。

## Decision

`import-local-library.mjs` 扫描明确选定的本机根目录，写入紧凑的 `.game-studio/library.json` 清单，其中包含来源、修订、入口、能力、素材数量和有界证据路径。`studio_library` 在 SCAN 阶段验证并检索这份清单，所有源目录保持只读并位于模型执行循环之外。

这份清单是元数据，不是模型训练或源代码导入：它不会复制二进制素材，不会运行发现的代码，并且返回有界结果。清单缺失时明确返回空状态，项目通过生成清单并将其放入工作区来选择接入。

## Alternatives considered

复制或执行发现的项目源代码会把上下文库变成运行入口；托管项目索引会把本地路径和资产带离操作员机器，因此均未采用。

## Consequences

preset 可以把用户本机已有的编辑器和试玩经验作为可搜索的生产上下文，同时保留来源可追溯性并隔离执行。项目或素材发生变化后必须重新生成清单，绝对来源路径是有意保留的本机元数据，不是可移植的项目配置。
