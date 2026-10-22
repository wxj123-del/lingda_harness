# Agent Note: 产品导航移到对话上方

Status: implemented

[English](2026-10-22-product-navigation-above-conversation.md) | 中文

## Problem

产品导航——对话、知识库、工作流、Skill、工具、插件——原本占着侧栏内一条独立的 56px 竖列，始终画在侧栏内容旁边。这条列把产品最紧张的横向空间用在图标上，而用户正在阅读的对话反而更窄；侧栏在每种状态下都得为它预留位置，内容因此整体右移 56px。

## Decision

`ui-layout` 声明 `shell.navigation`（root 作用域的 single slot），`AppFrame` 把它渲染为中栏的第一个子元素，位于当前主面板之上。导航条占对话的宽度而不是侧栏的宽度，且位于面板座位之外，所以切换面板不会让它移动。`ui-layout` 自己的 `ProductNavigation` 占位者渲染一行图标加文字的格子；文字直接放在格子里、不再依赖悬停提示，因为这条 bar 有对话那么宽。

功能面板通过 `shell.navigation.panels` 加入这条 bar——它是 `shell.navigation` 的子 list：每个主 slot key 一个条目，沿用 `sidebar.panellist` 的 `id`/`order`/`label` 元数据，图标组件收到 `{ size, active }`。`ui-workspace` 把 Flow 页面入口迁到这里，因此 Flow 页面保留导航入口而不占用侧栏行。

内部竖列被移除：`ui-sidebar` 不再声明或渲染 `sidebar.navigation`。侧栏保留品牌行、新会话、其余全局面板入口（`sidebar.panellist`）、工作区浏览器和底部；收起的 56px 轨道仍渲染展开按钮与这些面板入口。因此宽态的列表与轨道态的图标都仍可达，没有界面失去入口。

## Alternatives considered

**把整条侧栏移到对话上方。** 侧栏的价值在会话列表，它需要纵向空间和一个常驻列；横向顶栏得为同样内容另造下拉或横向滚动，改变的是浏览模型而不只是导航位置。

**保留竖列再加一条横条。** 同一外壳里出现两套指向相同目的地的导航，必然有一套冗余，而竖列的图标照样占用侧栏宽度。

**把横条放进侧栏内容里。** 那样它仍待在它所导航离开的那一列里，侧栏一收起成轨道就消失——恰好用户隐藏浏览列时，产品导航不可达。

已被[产品导航回到侧栏](2026-10-22-product-navigation-in-sidebar.zh.md)取代：该行移入侧栏、位于工作区小节之上，并去掉了「对话」入口。

## Consequences

无论展开还是收起，这条 bar 都从中栏占去 45px 纵向空间，包括空白的新会话首屏，它的标题现在在 bar 下方居中。窄窗口下 bar 位于收起轨道之上而非轨道内，因此文字仍可读。`shell.navigation` 对部署是叠加式的：注册进去会替换出厂 bar，而注册到 `sidebar.panellist` 仍会给侧栏增加一个面板入口。

## Verification

- `packages/client/ui-layout/tests/app-frame.client.spec.tsx` 断言 bar 位于中栏首位、在面板之前，且不在侧栏列内。
- `packages/client/ui-layout/tests/apply.client.spec.ts` 固定声明的 root slot，含 `shell.navigation`。
- `packages/client/ui-workspace/tests/apply.client.spec.ts` 断言 Flow 页面入口落在 `shell.navigation.panels`，且仍以 `workspace-flow` 为选中主 key。
- `packages/client/ui-sidebar/tests/sidebar-snapshot.client.spec.tsx` 在两种状态下快照侧栏，确认内部竖列已移除。
- `packages/client/ui-sidebar/tests/panel-list.client.spec.tsx` 继续固定全局面板入口在宽态列表与收起轨道中的行为。
