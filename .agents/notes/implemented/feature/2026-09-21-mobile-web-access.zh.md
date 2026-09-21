# Agent Note：显式手机 Web 访问

状态：已实现

[English](2026-09-21-mobile-web-access.md) | 中文

## 问题

Web GUI 已经能认证局域网请求并打印派生出的 LAN URL，但 CLI 拒绝绑定所有接口，因此同一网络的手机无法连接。

## 决策

为 Web 启动提供方增加显式 `--mobile` flag。它选择已有的 `0.0.0.0` WebServer 绑定，保留 LAN IP 发现、Host/Origin 检查和 token 认证，并打印提示，要求只在可信网络分享带 token 的 LAN URL。直接使用 `--host 0.0.0.0` 仍会被拒绝，`--mobile` 也不能和 `--host` 一起使用。

## 备选方案

**直接允许 `--host 0.0.0.0`。** 放弃，因为低层绑定 flag 容易意外开启网络暴露。

**增加独立手机应用或配对协议。** 延后，因为浏览器 GUI、签名 cookie 交换和 LAN 信任栅栏已经提供所需的手机路径，不需要第二个客户端或新的持久化协议。

## 结果

运行 `dsh web --mobile --no-open`，然后在同一可信网络的手机上扫描终端打印的二维码。二维码和备用 `LAN:` URL 都含本次进程 token；重启进程后 token 失效。不需要新增 session event 或 RPC 方法；只增加终端二维码渲染依赖。

## 验证

启动、Web runtime 和 LAN trust 聚焦测试通过（`26` 个测试）。文档配对记录已刷新。
