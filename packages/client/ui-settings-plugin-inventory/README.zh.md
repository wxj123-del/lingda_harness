---
description: "dsh Web 客户端的只读插件模块清单，按 Agent 预设和全局作用域分组，支持分类筛选与搜索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

[English](README.md) | 中文

## 概述

**插件**页面让 Web 用户查看 Agent 预设及全局条目中的插件模块，而不改变配置。分类筛选与搜索缩小清单范围，卡片展示启停状态与运行详情。实际的 Skill、工作流、工具和知识库由各自导航页面管理，不再重复计入插件卡片与数量。读取这些视图不会发起模型请求。

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

点击产品导航中的「插件」，即可查看宿主的插件清单。插件激活期间不会读取 Remote——首次打开页面时才挂载组件，并通过 `api-remotes` 懒调用 `ctx.remote.pluginInventory.list()`。

### 阅读卡片

每张收起的卡片使用模块短名称作为主标题，在下方显示稳定的条目 id，并以小标签表示启停状态；已启用的条目还会显示彩色根 fiber 状态圆点。组合生成的次标题省略开头的 `include:` 标记；悬停、搜索、无障碍名称与展开详情仍保留完整 id。长条目 id 会在行内截断，悬停时仍可查看完整值。展开卡片后会显示声明的条目 id、完整模块标识与状态事实：预设行说明它来自哪个预设、组合存活时的运行状态，以及它携带的禁用条件；被预设提供的全局行说明它由 Agent 预设按会话提供、列出启用它的预设，并提供跳转到预设组的入口。预设名经共享的 `presetDisplayText` 纯函数（`dsh-agent-presets/display`）叠在 [`ui-agent-preset`](../ui-agent-preset/README.zh.md) 的字典上解析：内置预设走当前语言，用户自建预设保留自己的元数据，因此英文界面不会回显预设文件里的中文名。搜索按模块名称与条目 id 过滤两组。

### 分类与预设切换器

**技能与工作流支持插件**汇集加载 Skill、调用 Skill 和支持工作流执行的模块。它不代表可用 Skill 清单；导入及用户创建的 Skill 统一在[技能广场](../ui-layout/README.zh.md)管理，无需迁移或复制已保存内容。

分类栏是浏览过滤器，不代表插件的启用范围。原有的**会话插件**和**全局插件**仍然保留，每个分类的数量对应当前查看的 Agent 预设与全局条目。分类器按固定顺序检查明确的标识符：外部集成与 RAG 关键词优先于通用 Tool 关键词，模型相关关键词包含文生图和语音模型标识符，无法匹配的插件归入**其他插件**。因此名为 `feishu`、`lark`、`mcp`、`rag`、`embedding`、`knowledge`、`image-generation` 或 `tts` 的自定义插件无需改包即可找到。搜索可以和分类组合使用。

预设切换器

切换器与通用设置各行使用同一种「选择胶囊 + 菜单」控件。它列出 roster 的每个预设——默认项带后缀、坏预设带标记——并且只改变列表显示什么：它不写任何设置，选中坏预设时在行的位置展示 discovery 报告的原因。选择默认预设或会话预设的入口仍在原处：Agent 预设分区与新会话页。

### 重试失败的读取

读取失败会在标签页内渲染通用失败状态；重试会重新执行懒 `list()` 调用，且不会暴露传输细节。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该标签页是宿主拥有快照的只读投影；插件激活期间不执行任何 Remote 读取，首次选择时才取快照。

### 注册

浏览器插件向 `ui-settings-plugins` 拥有的独立插件主页面注册清单 `settings.plugins.tab` 标签页。这个扩展点保留原有名称以支持已有贡献方，但不依赖设置弹窗。注册通过 `ctx.slots.inject()` 跟随声明、重新声明与 teardown；渲染器提供语言更新。

### 渲染

行 key 按作用域限定（`global:`、`preset:<id>:<index>`），因此同一模块出现在两个作用域时保持各自的展开状态；声明的条目 id 出现在展开详情中，并在去掉开头的组合 `include:` 标记后作为收起次标题，没有 id 的行不显示次级标签。预设提供标记在客户端推导：一个全局条目在全局被停用、且至少一个预设行对同一模块标识实际启用时才携带它，因此被所有预设关掉（或仅条件声明）的模块保持单纯的已停用，而不是夸大提供关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖独立主页面、Remote 调用与宿主侧投影。

- [ui-settings-plugins](../ui-settings-plugins/README.zh.md)——独立插件页面与标签页拥有方。

- [api-remotes](../../api/remotes/README.zh.md)——`pluginInventory.list()` 背后的 Remote BFF 表面。
- [plugin-inventory](../../host/plugin-inventory/README.zh.md)——本标签页所渲染的宿主侧只读 Loader 投影。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端清单投影，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义清单视图的新鲜度与触达范围；它们是当前包约束。

- **每次 Settings 挂载或重试只读取一份快照**：标签页不订阅 Loader 变化，也不会在重连后自动重新读取；切换标签页会保留当前快照，重新打开 Settings 则会取得新快照。
- **两个平面都只读**：标签页展示全局与预设的启停状态但都不修改；写回自定义预设组合文件的启停控件是刻意留作后续的工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包只持有一个只读 Settings contribution。
