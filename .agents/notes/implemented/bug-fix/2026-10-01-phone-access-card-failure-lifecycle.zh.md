# Agent Note: 手机访问卡兼容可选 Remote 与失败请求

Status: implemented

[English](2026-10-01-phone-access-card-failure-lifecycle.md) | 中文

## 问题

手机访问设置卡可能在未组合 Host Phone Access Remote 的 profile 中运行。通过 Cordis 的注入属性代理读取缺失命名空间会在启动时抛错。生成隧道时如果传输请求拒绝，卡片还会永久保持 `generating` 状态，用户无法重试。

## 决策

卡片通过 `ctx.get` 读取 `remote.phoneAccess`，未挂载的可选服务会返回 `undefined`。隧道生成捕获传输失败，记录可用于显示的错误文本，并在 `finally` 中始终清除 `generating`、重新发布 projection。成功响应和结构化 Remote 失败继续沿用原有结果处理。

## 考虑过的替代方案

**将 Phone Access 设为必需的 Client injection。** 不予采用，因为 settings 包由不组合 Host 隧道提供方的 profile 共享。

**静默吞掉生成失败。** 不予采用，因为卡片必须说明被拒绝的请求，同时仍允许重试。

**失败后重建 controller。** 不予采用，因为这会丢弃暂存的凭据表单，并用重新挂载掩盖可恢复的传输失败。

## 验证

Client controller 测试分别在挂载和未挂载 Phone Access 命名空间的真实 Cordis context 中启动。测试断言缺失服务时启动可以结算、生成被拒绝后会发布已清除的忙碌状态和错误、随后再次生成可以成功。定向 UI settings 测试文件和 Client lint 均通过。

## 后果

未组合 Phone Access 的 profile 不再产生未处理的启动 rejection。失败请求会持续显示在卡片中，直到下一次生成或其他状态更新；同一个 controller 可以重试而不会丢失表单状态。
