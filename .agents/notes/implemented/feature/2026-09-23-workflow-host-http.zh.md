# Agent Note：Host 控制的工作流 HTTP

Status: implemented

[English](2026-09-23-workflow-host-http.md) | 中文

## Problem

可视化 HTTP 节点之前只是发给 agent 的提示词，因此工作流无法确定性地发起请求、执行传输策略或直接返回有界响应。

## Decision

新增由 Host 拥有的 `httpRequest()` guest 绑定，并将可视化 HTTP 节点编译为该绑定。Host 校验 HTTP(S) URL 和方法，拒绝私有地址与非白名单目标，执行请求／响应字节上限、字符上限和超时，剔除敏感响应头，并且只在 Host 进程中解析凭据引用。可视化 GET 与 HEAD 节点会在配置的重试次数内重试抛出的请求错误；非幂等方法保持单次执行。VM 仍不可访问环境中的 `fetch`。

## Alternatives considered

**重试所有 HTTP 方法：** 否决，因为没有幂等键时重复 POST、PUT 或 PATCH 可能造成重复副作用。

**只在 Host HTTP 适配器内部重试：** 否决，因为重试预算和审计次数属于可视化节点，编译器必须让重试行为在节点执行记录中可见。

## Consequences

GET 与非 GET 可视化 HTTP 节点现在都会返回包含状态码、有界文本、响应头、截断状态和可选 JSON 的结构化响应。部署配置可以收窄 `httpAllowedHosts` 并调整资源上限。请求体和密钥不会进入进度日志。安全方法的重试有界，日志不包含响应内容；最后一次尝试失败后才将 HTTP 错误作为工作流致命错误，取消会中止 Host 请求。

## Validation

工作流 guest、Host 和 UI 编译器测试均通过，覆盖凭据剔除、白名单／私有主机拒绝、请求转发和原生 HTTP 编译。Workflow PTC 与 UI Layout TypeScript 检查通过。
