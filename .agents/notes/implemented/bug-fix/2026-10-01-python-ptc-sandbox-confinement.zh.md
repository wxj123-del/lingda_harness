# Agent Note：Python PTC 运行使用共享 sandbox 提供方

状态：已实现

[English](2026-10-01-python-ptc-sandbox-confinement.md) | 中文

## 问题

Python PTC 后端会在每次请求中启动全新的 CPython 进程，但此前受限权限策略不会约束该进程的文件系统效果。因此，即使会话选择了受限 sandbox 策略，模型程序仍可能读取或写入请求工作区之外的路径。

## 决策

运行时为每次请求解析 sandbox 策略；当策略不是 `danger-full-access` 时，要求共享的 `dsh-sandbox` 提供方约束 Python argv。缺少提供方会硬失败并返回 `sandbox-unavailable`，运行时不会静默回退到不受限子进程。PTC 结果返回选定模式、实施结果和观察到的拒绝，调用方可以区分策略选择与实际实施。

启用 workspace-write profile 时，Linux 的 bootstrap 暂存位置会避开被遮蔽的 `/tmp` 挂载。暂存目录保持私有并在每次运行后删除，因此模型进程只能影响本次运行自己的临时副本。

## 备选方案

**依赖 Python 层路径检查。** 放弃，因为模型代码可以通过其他 syscall、原生模块或子进程绕过应用层检查。

**sandbox 不可用时按全权限运行。** 放弃，因为这会把基础设施故障变成未披露的权限扩张。

**多个运行共享一个 bootstrap 暂存目录。** 放弃，因为模型代码可以改写 bootstrap；每次运行单独物化可以把影响限制在当前子进程。

## 验证

运行时 TypeScript 检查和定向 lint 已通过。在 CPython 3.11 下，完整 Python runtime 套件通过 287 个测试，另有 2 个有意跳过。真实 sandbox 测试验证 workspace-write 允许工作区内写入并拒绝外部路径，read-only 拒绝工作区写入，缺少 provider 时 fail closed。发布前还必须通过 runtime-closure 与 package dependency gate。

## 结果

受限 Python PTC 执行现在依赖正确组合的共享 sandbox 提供方。确实需要不受限 Python 时必须显式选择 `danger-full-access`；该模式不要求 sandbox provider。Linux 暂存只把宿主可见的 bootstrap 放在 `/var/tmp`，模型可见的临时文件仍位于受约束的 `/tmp`。
