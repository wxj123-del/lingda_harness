---
description: "一条 ngrok 隧道和一个扫码地址，让不在同一网络的手机打开正在运行的 DSH Web 界面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-phone-access

[English](README.md) | 中文

## 概述

`dsh-phone-access` 为正在运行的 Web 界面打开一条 ngrok 隧道，并把扫码地址和放行该主机名的重启命令交给浏览器。authtoken 是一条凭据，不是一项设置。

## 配置

这一行不接受任何键。在**设置 → 连接服务 → 手机访问**里保存 ngrok authtoken；它以凭据引用 `DSH_NGROK_AUTHTOKEN` 存放，并且只通过 `NGROK_AUTHTOKEN` 环境变量交给 `ngrok` 进程。

```yaml
- id: phone-access
  name: '@deepseek-ai/dsh-phone-access'
```

生成二维码会先关掉本进程已有的隧道，再启动 `ngrok http <web 端口>`，并从 `http://127.0.0.1:4040/api/tunnels` 读取 https 地址。扫码地址是这个地址加上本进程的启动令牌，卡片同时给出 `dsh web --trusted-host <主机名>`。先退出 DSH，运行这行，等它起来后再扫。本进程从不重启自己，隧道随进程结束。

## 模型体验

### 隧道状态

#### 模型看到什么

什么都没有。打开隧道并返回扫码地址不会进入模型请求、提示词或工具结果。这个地址只留在 `phoneAccess` 远程响应里。

#### Token 影响

无。不添加、删除或改写任何消息。

#### KV 缓存影响

无。请求前缀不发生变化。

## 已知限制与延后工作

- **免费域名每次启动都会变** — ngrok 分配的主机名只有隧道起来之后才知道，而浏览器信任名单在进程启动时就固定了，所以每个新域名都要先按卡片给出的命令重启，扫码才会成功。
- **每个进程一条隧道** — 第二次生成会关掉第一次打开的隧道。两个 DSH 进程不能共用 ngrok 的本机检查接口。
- **必须安装 ngrok** — 本包启动 `PATH` 上的 `ngrok` 可执行文件；它不存在、authtoken 未配置、检查接口超时或进程退出时，卡片给出原因。
