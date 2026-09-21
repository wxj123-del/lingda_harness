# Agent Note：Desktop 设置更新操作

[English](2026-09-21-desktop-settings-update.md) | 中文

状态：已实现

## 问题

Desktop 已经有签名 Electron 发布更新器，但应用界面此前只能通过原生菜单使用它。源码 checkout 和浏览器启动的 Web 页面都不能安全地替换正在运行的文件。

## 决策

向可信的 `dsh-app://app` 渲染器提供仅限更新的桥接，并在「通用设置」注册复用现有 `DesktopUpdateCoordinator` 的设置行。该行检查配置的签名 Desktop 发布流，并可安装可用版本；非 Electron 浏览器不会渲染此行。源码 checkout 继续使用文档中的 Git 和构建流程。

## 影响

设置行和原生菜单共享同一个 single-flight 检查/安装操作与状态发布流。桥接不会向应用渲染器暴露文件系统、shell 或插件控制。源码 checkout 仍需执行 `git pull --ff-only`、安装依赖、构建并重启进程；GitHub 提交只有在签名发布产物发布后才会成为可安装的 Desktop 版本。

## 验证

设置、preload 和 Desktop 构建聚焦检查通过。仓库级客户端 i18n 检查仍报告 `ui-trajectory/WorkflowView.tsx` 中三个既有硬编码字符串。
