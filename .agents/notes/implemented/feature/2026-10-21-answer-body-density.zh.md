# Agent Note: 回答正文的密度收口

Status: implemented

[English](2026-10-21-answer-body-density.md) | 中文

## Problem

聊天区的 agent 回答在三个方向上是无界的，而输入区、地图、详情栏都有明确上限。长代码块没有任何高度限制，`pre` 用 `pre-wrap` + `break-all` 折行，一个几百行的围栏块会把整条回答竖向撑出几屏；四列及以上的 markdown 表格通过 `AssistantMarkdown.module.css` 里的一条外扩规则吃掉正文列的 `max-width`，用负 margin 伸到整个 transcript 宽度，把消息列撑开；正文的标题上边距是 32px、段距 16px，多标题的回答显得比同屏其他内容松散得多。jsdom 没有布局，现有测试只验证 DOM 结构与字号轴，所以这三件事都没有守。

## Decision

**代码块自带上限。** `CodeBlock.module.css` 的 `pre` 增加 `max-height: var(--dsl-code-block-max-height, min(420px, 60vh))` 与 `overflow-y: auto`。语言栏是内容节点的兄弟、位于滚动区之上，因此 Copy 不会随源码滚走；60vh 保证矮窗口下单个代码块不会占满视口。宿主若已经拥有视口，把变量设为 `none` 即可退回到无上限：`ui-sidebar-documentpreview` 的 `CodeBody.module.css` 就是这么做的，它自己滚动 `[data-code-block-content]`，再套一层滚动条只会变成双滚动。

**宽表格留在正文列内。** 删除 `AssistantMarkdown.module.css` 中 `.body :global(.md-table-wide)` 的外扩规则（`--dsh-table-spare` / `--dsh-table-lead` / 负 margin / `max-width: none`）。渲染器的 `md-table-wide` 钩子仍然存在，表格仍按自然宽度排布，横向滚动交给 `MarkdownText.module.css` 里本已存在的 `.tableScroll`（静止 `overflow-x: auto`，悬停/聚焦揭示滚动条）。1600px 宽的表格过去会让消息列横向外溢，现在只在列内滚动，列宽与输入框的对齐关系不变。

**正文纵向节奏收紧。** 标题上边距 32px → 24px、下边距 16px → 12px，h4–h6 保持 16px 上边距但下边距 16px → 8px，段落间距 16px → 14px。这一条只改纵向留白，不动列宽、字号与行高。

## Alternatives considered

**把正文列宽加上字符数上限（如 88ch）。** 已拒绝（本轮）：这是唯一一条会改变视觉留白与折行位置的改动，收益是阅读行长，但它动的正是用户明确要求不要影响的布局本身，留作单独决策。

**用 `FoldToggle` 给整段回答加折叠。** 已拒绝：`FoldToggle` 现在只服务于 ReadBlock/DiffBlock 的固定行数折叠；给流动的 markdown 正文加折叠需要在渲染树里插入可展开边界，流式追加时的展开状态、选择、锚点都会跟着重建，代价与收益不匹配，而限高已经解决了占屏问题。

**把宽表格整体移进右侧详情栏。** 已拒绝：表格是回答的一部分，移走后正文会出现「见详情」的断点；而且详情栏是回合级入口，不是逐表格入口。

**保留外扩、只加大列宽上限。** 已拒绝：外扩本身就是问题——它让一条消息横向越过与自己无关的布局边界，改上限只是把越界推远。

## Consequences

现在一条长回答的纵向长度由内容决定而不是由最长的代码块决定，多个长代码块叠加也不会把 footer 推离视口。代价是代码块内的复制整块内容不再能一次看全，需要先在块内滚动；表格在悬停前不显示横向滚动条（Chromium 只在悬停时重绘该条，这一行为沿用既有实现）。

`tests/answer-density.client.spec.ts` 以读声明的形式守住三条：代码块的上限与 `overflow-y`、预览宿主的 `--dsl-code-block-max-height: none`、正文模块不再含有外扩的任一要素，以及 `.tableScroll` 的列内滚动。既有 138 个 client 测试文件、1926 个用例中 1925 个通过；唯一失败是 `pdf-license-bundle.client.spec.ts`，它在回退本次改动后同样失败，原因是该用例要求以 pnpm 打包而当前 `npm_execpath` 指向 npm，与本次改动无关。
