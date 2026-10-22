# Agent Note: 工作区流程总览

Status: implemented

[English](2026-10-18-workspace-flow-overview.md) | 中文

## Problem

一个 Workspace 汇集了访问同一目录的所有 Session，但浏览器只按最近更新时间或手动位置列出它们。没有任何地方回答：这个文件夹里的对话哪些还需要人处理、哪些正在跑、哪些已经开了任务清单、哪些已经结束。用户必须逐个打开行、阅读对话或任务面板才能拼出这幅图景。

## Decision

Workspace 行的 `...` 菜单新增**流程总览**。它在布局主区域打开一个**独立页面**——不是对话框——显示一个看板，每个阶段一列：**等待处理**、**工作中**、**进行中**、**待工作**、**已完成**。每张卡片带有 Session 标题、最近活动时间，以及在该 Session 带有 `todos` 投影时显示带完成数／总数的进度条。选择卡片会打开该 Session 并离开该页面。

页面头部显示 Workspace 名称以及会话数与完成数，提供**切换工作区**把看板切到另一个 Workspace，以及**返回会话**。本包还在侧边栏全局面板导航中注册了**流程**一行（`sidebar.panellist` 加上 `workspace-flow` 这个 `main` keyed slot 条目），因此重新打开页面时展示的是上次的 Workspace 而不是空看板。选中任何主面板都会把侧边栏收成窄栏——这是现有布局行为，此处未改动。

`deriveWorkspaceFlow`（`packages/client/ui-workspace/src/client/flow.ts`）是同一份列表快照上的纯投影，与现有行读取同一份数据。阶段优先级是固定的：

1. 存在待处理交互（`approval`、`plan-review`、`question`）→ **等待处理**。
2. Session 自身的运行位，或经不间断 subagent 谱系可达的任一后代正在运行 → **工作中**。
3. 空白临时 Session → **待工作**。
4. 非空 `todos` 列表：存在 `in_progress` 条目 → **进行中**；所有条目均为 `completed` → **已完成**；否则 → **待工作**。
5. 没有列表时看 `turnOutline`：空的轮次大纲表示从未开始过回合 → **待工作**；非空 → **已完成**。
6. 大纲未知（cold 行且没有 projection checkpoint）→ **已完成**。

已归档 Session 与子代理来源行不会出现，与浏览器列表一致。各列保持上述固定顺序，列内按最近更新时间降序，时间相同时以 Session id 作为稳定排序依据。

浏览器与页面共用一个视图 store 句柄，因此文件夹菜单通过它已经收到的 actions 写入 `flowTarget`，页面读取同一个 root 实例；注入的 `openFlow` 回调只负责选中主面板。有两条纯类型的包依赖承载投影声明：`@deepseek-ai/dsh-tool-todo/client` 提供 `todos`，`@deepseek-ai/dsh-session-turn-outline/client` 提供 `turnOutline`。两者都不导入运行时。

## Alternatives considered

**总览对话框**是最初的实现，评审后被否决：一个工作区的流程是需要跨会话反复对照的常驻视图，而对话框是临时的，关闭后不再派生，也无法返回。页面还能给每个阶段一个真正的列，而不是堆叠的列表。**从对话内容推导阶段**被否决：它需要打开 Workspace 中的每个 Session，而列表快照恰恰刻意避免这一点。**新增 Host 侧阶段投影**被否决：所有输入都已经随列表下发（`running`、`completed`、`todos`、`turnOutline`），新增持久 key 只会为重新推导既有事实追加一套线格式和 cache 行。**把总览做成行内 Sessions 子菜单**被否决：这个功能的意义在于横向比较整个文件夹的阶段，而按最近更新时间排列的列表做不到。**把没有列表且从未开始的 Session 归为已完成**（最初的实现）在测试暴露它会把没人提示过的会话说成已收尾后被否决；`turnOutline` 提供了缺失的开始状态依据。**把未知大纲当作待工作**被否决：cold 行缺少 checkpoint 不构成有待办工作的证据，因此它会落到已完成，而不是凭空制造一项义务。**把页面目标放进浏览器的本地状态**被否决：页面与菜单位于不同的 slot 条目，目标必须在侧边栏重新挂载、以及从侧边栏一行重新打开页面之后仍然有效——共享的持久化 store 才是两个条目都能读取的那条通道。

## Consequences

总览是只读的：它不启动任何运行、不修改 Session、不写入任何持久数据。它全部状态中只有 `flowTarget` 会持久化，作为新 key 落在既有的 `dsh.workspace.view.v5` 浏览器 store 条目里；此前写入的值不含该 key，读出来即“无目标”，页面按其他无目标情形处理。cold Session 的阶段准确性依赖列表已经提供的 projection-cache 行；缺少 checkpoint 时，已经开始的 Session 可能在摘要带着投影值刷新之前显示为**已完成**。`todos` 列表是 agent 自己的常驻计划，因此一个回合结束但清单仍未完成的 Session 会显示为**进行中**而不会滞留在**工作中**——这个区分是有意的：实时活动 vs. 已声明的剩余工作。页面为 `ui-workspace` 增加了两条纯类型依赖边、一个 main slot 条目、一个侧边栏面板行和一个页面内 CSS module；它不发出 Cordis 事件。

## Verification

`tests/flow.client.spec.ts` 覆盖阶段优先级、空白 Session、后代活动、任务数字、并列排序、由大纲驱动的开始状态区分，以及归档／子代理过滤。`tests/flow-page.client.spec.tsx` 覆盖空目标、按阶段的列与卡片、等待用户列、卡片导航、返回会话、工作区切换器及其关闭、Workspace 缺失回退、空白会话卡片、now 时间桶，以及面板图标。`tests/workspace-browser.client.spec.tsx` 覆盖菜单写入目标并选中页面。`tests/apply.client.spec.ts` 覆盖两处注册与注入的导航回调。`ui-workspace` 的包覆盖率在语句、分支、函数和行四项上均为 100%。
