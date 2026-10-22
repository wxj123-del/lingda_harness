# Agent Note: 产品导航回到侧栏

Status: implemented

[English](2026-10-22-product-navigation-in-sidebar.md) | 中文

取代[产品导航移到对话上方](2026-10-22-product-navigation-above-conversation.zh.md)。

## Problem

把面板导航做成对话上方的横条，在每个状态下都从中栏占去 45px 高度，而且把目的地放进了阅读区域，而不是列出这些目的地面向内容的侧栏。那条横条还带着「对话」入口，它和侧栏自己的新会话控件、工作区浏览器是同一个去处，属于重复。

## Decision

`sidebar.navigation` 是 root 作用域的 single slot，由 `ui-layout` 声明（`ui-sidebar` 本来就依赖它取 `MainPanelId`），由 `ui-sidebar` 渲染在新会话控件与工作区小节之间的座位上。`ui-layout` 的 `ProductNavigation` 占据它：知识库、工作流、Skill、工具、`sidebar.navigation.panels` 贡献的条目（工作区的流程页），再由一条整行分隔线后的插件。

「对话」入口已移除——侧栏的新会话控件与工作区浏览器就是回到对话的方式，因此这一行只放面板目的地。

每个目的地各占一整行，与下方会话行对齐，列变窄时六个入口也不需要横向滚动即可触达；每个入口保留 tooltip，且仅在只显示图标时启用。座位随布局状态移动而不是被复制：展开时渲染在内容列中并显示文字，收起动画结束后渲染在 56px 轨道里作为图标列。收起动画进行期间，该行留在冻结的内容列中，避免入口跨两套布局。

## Alternatives considered

**保留对话上方的横条，只删掉「对话」入口。** 那仍在阅读区域上花掉高度，用于本该属于侧栏自身列表导航。

**两种状态各留一个导航座位。** 同一批目的地有两个座位意味着每个面板特性要注册两次，两边还可能对选中态各执一词。

**把该行放在品牌行之上。** 品牌行是这一列的身份；导航读起来是这一列所列内容的目录，应该紧邻它所引导的工作区小节。

现在选择面板只切换中栏。`AppFrame` 过去会在当前面板不是对话时收起侧栏，`ui-sidebar` 也会在其他所有面板下隐藏工作区浏览器；两者都已移除，因此用户导航时所在的列始终不动。`openSession` 仍会选中对话面板，所以点击某个会话会把中栏切回对话。

## Consequences

侧栏展开后的内容现在以导航行开头，因此工作区标题下移约 40px。由于侧栏在面板页不再收起，这些页面的中栏比过去窄 280px；出厂的面板都是带自己页头的整页，因此读起来是两栏布局，而不是被挤压的对话。收起轨道得到图标列，并失去它过去从 `sidebar.panellist` 渲染的重复面板列表；那份列表仍驱动无包占据导航座位时外壳的回退行。替换 `sidebar.navigation` 的部署在两种状态下都拿到这一行，需自行渲染紧凑形态。

## Verification

- `packages/client/ui-sidebar/tests/sidebar-snapshot.client.spec.tsx` 在两种状态下固定该座位（展开在内容列、收起在轨道）。
- `packages/client/ui-sidebar/tests/panel-list.client.spec.tsx` 继续固定回退列表，包括无面板注册时不渲染空列表。
- `packages/client/ui-workspace/tests/apply.client.spec.ts` 断言流程入口落在 `sidebar.navigation.panels`，且仍选中 `workspace-flow`。
- 已实测：展开行在工作区上方渲染知识库/工作流/Skill/工具/流程/插件，且没有「对话」入口，浅色与深色均验证；收起轨道显示六个图标。
