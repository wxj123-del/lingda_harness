# Agent Note: 会话级对话终端

Status: implemented

English | 中文

## Problem

交互式终端此前只能从右侧栏进入，而 Session 的主导航已经提供对话视图页签。用户需要在这些视图旁看到稳定的终端入口，并且不同 Session 不能看到彼此的 shell 状态。

## Decision

`ui-sidebar-terminal` 以 `terminal` id 在现有记录视图之后注册 `conversation.view`。该入口解析 `ctx.webTerminals.view(sessionId, 'conversation-terminal', conversationTerminalId(sessionId), undefined, true)`，为每个 Session 提供一个确定性身份且按需启动的终端，同时保留原有可多开的右侧栏终端功能。两个界面共享 xterm 屏幕渲染器，并通过同一个 observable 读取应用主题。

切换离开视图只断开浏览器流；Client 终端模型继续保留 PTY，返回视图时重新连接。恢复逻辑跳过这个保留的确定性身份，因此刷新页面不会把它重复打开为右侧栏页签。Session 所有权仍由 `api-terminal-controller` 管理，因此不同 Session id 会得到不同的 Host 终端身份和进程生命周期。

## Alternatives considered

**复用右侧栏终端 occurrence。** 右侧栏页签可由用户创建、复制、移动或关闭；把对话页签绑定到其中一个会让它的可用性和生命周期依赖另一种界面。

**新建终端包。** 现有包已经拥有终端 UI、主题行为和 controller 注入。新包会复制 xterm 生命周期代码并拆分终端文档。

**对话视图卸载时结束 shell。** 视图切换和 Session 导航只是展示变化，不是明确的关闭请求。保留并重新连接符合右侧栏切换行为。

## Consequences

每个打开对话终端的 Session 都会占用一个 Host 终端额度，直到 controller 或 Session owner 清理它。只有组合了终端 controller 和 PTY 后端时才会出现该页签；现有右侧栏终端和恢复行为不变。
