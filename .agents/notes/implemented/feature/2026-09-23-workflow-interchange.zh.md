# Agent Note：工作流文件互通

Status: implemented

[English](2026-09-23-workflow-interchange.md) | 中文

## Problem

可视化工作流编辑器已经可以创建、发布、复制和运行流程，但在不同安装之间迁移工作流仍需要手工重建。成熟的工作流操作台需要便于检查的文件格式，并且导入时不能覆盖已有的已发布工作流。

## Decision

增加带版本的 `dsh-workflow` JSON/YAML 互通格式。导出内容包括工作流描述、执行说明、图结构、连线和画布视口，不包括压缩包、运行历史或密钥。凭据只保留引用名。操作台支持导入 `.json`、`.yaml` 和 `.yml` 文件，并限制文件大小、节点数、连线数、标识符和图引用。导入文件会生成新的 id，并始终进入草稿状态。编辑器提供明确的 JSON 和 YAML 下载操作。

## Alternatives considered

要求手工重建无法支持可审查的迁移；导出 archive、运行历史或凭据值会携带安装相关数据或秘密，因此均未采用。

## Consequences

工作流可以放入代码仓库审阅，也可以在不同安装之间迁移，不需要命令行。导入不会静默替换已发布流程，审阅后必须重新发布。为方便手工编写，也接受不带 envelope 的原始工作流对象；不支持的 envelope 版本会明确失败。

## Validation

工作流面板和互通测试通过 20 个用例。UI Layout TypeScript 检查通过，`git diff --check` 通过。

