---
description: "飞书机器人回调适配器：把手机聊天路由到按聊天复用的 DeepSeek Harness Agent 会话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-feishu

[English](README.md) | 中文

## 概述

`dsh-webhook-feishu` 把飞书自建应用机器人接入 DeepSeek Harness Agent 会话。默认 WebSocket 长连接只需要出站 HTTPS/WSS，不需要公网回调路由；可选的 HTTP 传输方式会注册精确回调路由，处理 URL 验证、verification token 校验和文本消息解析。两种方式都会为每个聊天复用一个 Agent 会话，并通过飞书把最终助手文本发回聊天。

## 配置

| Key | 含义 |
|---|---|
| `path` | 精确回调路径，默认 `/feishu`。 |
| `transport` | 默认推荐 `websocket`，使用出站飞书长连接；也可选 `webhook` 使用 HTTP 回调。 |
| `appIdEnv` / `appSecretEnv` | 飞书自建应用凭据引用。 |
| `verificationTokenEnv` | 飞书事件 verification token 的凭据引用；仅 `webhook` 传输方式必需。 |
| `encryptKeyEnv` | 可选签名密钥。首版会拒绝加密回调 body；请关闭加密，或等待后续长连接适配器。 |
| `workspacePath` | 飞书聊天 Agent 共享的绝对工作区。 |
| `agentPreset` / `permissionPreset` | Agent 组合与工具安全策略。 |
| `allowedOpenIds` | 可选用户白名单；为空表示允许所有已验证发送者。 |
| `requireMention` | 群聊是否必须 @机器人，默认 `true`。 |

示例：

```yaml
- id: feishu-bot
  name: '@deepseek-ai/dsh-webhook-feishu'
  config:
    path: /feishu
    appIdEnv: DSH_FEISHU_APP_ID
    appSecretEnv: DSH_FEISHU_APP_SECRET
    workspacePath: !!js process.cwd()
    agentPreset: standard
    permissionPreset: read-only
```

默认 `websocket` 传输只需开启机器人，选择飞书的长连接事件模式并订阅 `im.message.receive_v1`，不需要公网回调地址或 verification token。使用 `webhook` 时，需要提供 `verificationTokenEnv`，并把回调地址配置为末尾带 `/feishu` 的公网 HTTPS 地址。私聊按 `open_id` 路由，群聊按 `chat_id` 路由。同一聊天的第一条消息会创建会话，之后继续复用。

## HTTP 约定

只接受 `POST`。`url_verification` 在 token 验证成功后返回 challenge。消息事件在 Agent 执行前返回 `202`，模型回复异步发送。token 无效返回 `401`，body 超限返回 `413`，凭据缺失返回 `503`。

## 模型体验

### 飞书聊天轮次

#### 模型看到的内容

每条已接收的文本消息都会成为映射 Agent 会话中的普通 user 消息；飞书聊天只作为传输元数据，不会变成隐藏提示词。

#### Token 影响

每个已接收轮次保留一条用户消息，在普通压缩移除或总结历史之前会贡献 Token。

#### 控制命令

Feishu 适配器会在 Agent loop 之前执行已注册的 slash command。`/mode qa`、`/mode coding`、`/compact` 等命令不会启动模型 turn；未注册的 slash command 会直接返回未知命令。`现在是什么模式`、`改为编码模式`、`切换到研究模式` 等明确的中文模式短语也会映射到 `/mode`。普通文本仍然按对话消息交给 Agent。

#### KV Cache 影响

在既有会话前缀之后追加；同一聊天继续对话时保留可复用前缀，只增加新的轮次。

#### 回复渲染

助手回复会以带 Markdown 元素的飞书富文本消息发送，而不是普通纯文本消息。因此标题、强调、列表、表格、链接和围栏代码会在飞书中正常渲染。较长回复会优先按行边界切分后发送。


## 已知限制与延期工作

- **HTTP 加密回调关闭**：此版本不会解密 HTTP 回调 body；默认 WebSocket 传输不受此限制。
- **聊天映射在内存中**：进程重启后聊天到 Agent 的绑定会丢失；持久化会话恢复延期实现。单进程内会把重复事件 ID 限制在 2048 条以内。
- **纯文本回复**：富卡片、文件、图片和流式增量回复延期实现。
