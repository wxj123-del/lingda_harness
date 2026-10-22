---
description: "冻结的已发布 v3 Session 读取器，以及发布为 v4 的身份迁移。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

[English](README.md) | 中文

## 概述

`dsh-session-format-v3-to-v4` 在新的格式版本下发布未改变的逻辑 V3 Session 语言。V4 codec 复用 V3 的物理 framing 与事件编码；相邻的流式迁移只改变 header version，并保留事件顺序、身份、载荷和继承切点。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时使用

持久化通过 `dsh-session-format-catalog` 获取该迁移边；应用不会把它作为插件挂载。只有在装配或测试静态已发布格式目录，或检查 V3 到 V4 兼容边界时才直接导入本包。

### 入口

```text
const targetHeader = sessionFormatV3ToV4.migrateHeader(sourceHeader)
const stage = sessionFormatV3ToV4.createStage({ sourceHeader, targetHeader, sourceInheritedEventCount, sourceKind: 'decoded' })
stage.transformEvent(event, migrationContext)
const inheritedEventCount = stage.finish(migrationContext)
const headerRecord = releasedV4SessionFormatCodec.encodeHeader(targetHeader, inheritedEventCount)
const eventRecord = releasedV4SessionFormatCodec.encodeEvent(event)
```

`releasedV4SessionFormatCodec` 只接受 V4 header，然后通过私有版本转换把物理行规则交给冻结的 V3 codec。`sessionFormatV3ToV4` 是身份 body stage：保留每个已接纳事件，并验证密集顺序和 seeded Session 的继承切点。`restoreReleasedV4Artifact` 通过冻结的 V3 规则执行事件关系与载荷校验，不暴露私有 V3 视图。

即使物理布局没有变化，这次版本升级仍然是有意的。它记录新增消息来源变体和 workflow schedule 载荷的当前持久化 schema acknowledgement；未来 reader 可以拒绝更新的 writer version，而不是猜测其含义。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/codec.ts`](src/codec.ts) | V4 header 边界与 V3 物理 framing 委托 |
| [`src/migration.ts`](src/migration.ts) | 流式身份转换与继承切点校验 |
| [`src/validation.ts`](src/validation.ts) | 通过冻结 V3 规则执行 V4 header 与 artifact 校验 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [已发布 V2 到 V3 迁移边](../session-format-v2-to-v3/README.zh.md)——本包复用的源 codec 与逻辑契约。
- [静态目录](../session-format-catalog/README.zh.md)——构建拥有的 codec 与迁移顺序。
- [Session 持久化子系统](../../../docs/subsystems/persistence.zh.md)——generation 选择与 successor 发布。

-----

<a id="model-experience"></a>
## 模型体验

### 历史还原

#### 模型看到什么

模型看到的 restored messages、tools、metadata 和事件关系与 released V3 artifact 完全相同；该迁移不会改变逻辑内容。

#### Token 影响

身份迁移不会添加、删除或重新解释任何模型可见 token。

#### KV Cache 影响

逻辑请求前缀保持不变，因此该版本边界本身不会改变缓存身份。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **复用物理布局**——V4 有意复用 V3 framing；未来的物理变化需要单独的 codec 与迁移边。
- **不负责发布**——successor 文件的发布和原子替换由持久化拥有；本包只提供纯 codec 与迁移函数。

不会发布 runtime invariant companion，因为本包是纯格式 codec 和迁移边。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
