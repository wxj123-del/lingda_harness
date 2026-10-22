# Agent Note: 桌宠汇报任务进度

Status: implemented

[English](2026-10-22-desk-pet-task-progress.md) | 中文

## Problem

Desktop 里一次任务可能跑上几分钟，而展示进展的窗口常常被别的窗口挡住。吉祥物已经在侧栏和新会话首屏承担产品身份，但应用窗口之外没有任何东西告诉用户：任务还在推进、推进到哪一步、或者刚刚结束。

## Decision

`apps/desktop` 新增第二个窗口 `dsh-app://shell/pet.html`：无边框、透明、以 `screen-saver` 层级置顶、在所有工作区与全屏空间可见、不出现在任务栏和窗口切换器，且 `focusable: false`。整个表面都是拖动热区——指针位移经 IPC 以增量转发，由 `setPosition` 应用，所以拖动移动的是操作系统窗口，而不是窗口内的图。应用菜单可切换显隐，`DSH_DESKTOP_PET=0` 可不带桌宠启动壳。

桌宠通过 Host 自己的 `/api/session/list` 通道轮询：有任务时每两秒一次，空闲时每八秒一次；回复由 `pet-state.ts` 折叠（纯函数、可测）：`running` 且非 blank 的 Session 计为在忙；被跟随的是最近一个带 `todos` 投影的运行中 Session，没有则退回最新的运行中 Session；其计数成为气泡的进度条，第一条 `in_progress` 成为气泡正文。任务停止后，`pet.ts` 锁存六秒的 `done` 阶段——笑眼表情——再回到空闲。

两个吉祥物状态都以 WebP data URL 内嵌在 `renderer/pet.js`（正视图用于工作与空闲，闭眼笑用于完成），因此桌宠不需要资源管线，也不联网。它不依赖框架，因为该窗口在应用自己的渲染层还在启动时就存在。

## Alternatives considered

**把桌宠画在应用窗口内一块透明区域里。** Web 渲染层无法画到窗口之外，而一个在窗口被隐藏或最小化时消失的桌宠——恰好是用户在做别的事情的时候——失去了这个功能的意义。

**为桌宠再启动一个 Host。** 桌宠只需要一次读：Session 列表。第二个 Host 会翻倍进程、重复投影缓存，并破坏恢复与插件变更所依赖的「每个 Desktop 只有一个 Host」不变量。

**由应用渲染层通过共享 store 驱动桌宠。** 这把桌宠的存活绑在主文档上：渲染层崩溃或跳转到启动页时桌宠会静默冻结，而那正是它最关键的时候。

**用矢量吉祥物代替位图。** 品牌标识阶段已试过并否决：设定图的渲染在 24px 下清晰可辨，矢量化版本反而发糊，而这里需要的两个表情只以插画形式存在。

## Consequences

桌宠是第二个置顶窗口，因此 `before-quit` 显式关闭它，避免在随窗口退出的平台上触发 `window-all-closed`。它不持有自己的 Host 状态：后端重启时轮询失败、桌宠显示空闲，下一拍自动恢复。不想要它的用户可以设 `DSH_DESKTOP_PET=0`；菜单开关只作用于本次运行，使启动状态保持可预期。轮询是每拍一次普通 RPC，因此在任务运行时每两秒产生一个请求。

## Verification

- `apps/desktop/tests/pet-state.spec.ts` 固定折叠规则：running/blank 过滤、带待办 Session 的选择、缺投影时的回退、畸形条目与 RPC 信封。
- `apps/desktop/tests/pet.client.spec.ts` 固定窗口驱动：初始位置、工作/空闲轮询节奏、锁存的完成态、拖动增量与保存角落、后端不可用时的空闲，以及销毁。
- `apps/desktop/tests/pet-renderer.spec.ts` 在 jsdom 中固定渲染契约：三个阶段、进度条宽度，以及指针手势转成的拖动 IPC。
- 已在打包壳的开发运行中实测：一条真实提示词把桌宠从空闲推到工作中，走过真实 `todo_write` 列表的 33/67/100%，进入完成态；三次拖动增量使窗口精确移动了它们的和。
