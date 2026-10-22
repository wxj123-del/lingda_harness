# 飞书机器人远程聊天

[English](feishu-bot.md) | 中文

Web 版 DSH 内置飞书机器人，可以让手机通过飞书自建应用机器人和 Lingda Harness Agent 聊天。默认使用飞书出站 WebSocket 长连接，因此电脑不需要公网 IP、入站端口、HTTPS 回调，也不要求手机和电脑连接同一 Wi-Fi。命令行用户仍可以使用下方的 overlay 配置。

需要理解消息从飞书到 Agent 再回到飞书的完整过程时，请阅读[飞书机器人全链路文章](feishu-bot-end-to-end.md)。

## 前置条件

- 飞书开放平台企业自建应用，并开启机器人能力。
- 开启 `im.message.receive_v1` 事件订阅；默认传输方式请选择飞书的**长连接**模式。
- 准备应用的 `App ID` 和 `App Secret`；只有选择 HTTP webhook 传输方式时才需要事件 `Verification Token`。
- 准备本地 DSH 工作区，以及适合远程使用的 permission preset。

## 在设置中配置

Web 版 DSH 已经内置飞书连接服务。启动后打开 **设置 -> 连接服务 -> 飞书机器人**，填写 App ID、App Secret、工作区路径、Agent 预设和权限预设（建议先使用 `read-only`），再选择是否要求群聊 `@机器人`。

保存后重启 DSH，机器人会通过出站 WebSocket 连接飞书。手机不需要和电脑在同一个网络，也不需要给电脑开放公网端口。

## 命令行配置（可选）

把凭据值放在环境变量中，不要写入 patch：

```sh
export DSH_FEISHU_APP_ID='cli_xxx'
export DSH_FEISHU_APP_SECRET='replace-with-app-secret'
export DSH_FEISHU_WORKSPACE=/path/to/your/workspace
```

使用随附 overlay 启动 DSH：

```sh
pnpm run dsh web --patch apps/cli/config/examples/feishu-bot/cordis.yml
```

在飞书中打开机器人私聊，或把机器人加入群聊。私聊按发送者创建一个 Agent 会话；群聊按聊天创建一个会话，默认要求 `@机器人`。每轮模型完成后，回复会发回飞书。

## 安全

建议从 `permissionPreset: read-only` 开始。启用更宽松的工具策略前，先在 `allowedOpenIds` 中加入明确的发送者 ID。机器人继承所选 Agent 组合的本地工作区权限，不要对不受信任的企业租户或群聊开放执行型 preset。

当前聊天到会话的映射和重复事件缓存都在进程内。重启 DSH 后实时映射会丢失；持久化恢复、富卡片、媒体和流式回复延期实现。

## HTTP 回调备选

将 `transport` 设为 `webhook` 可使用 `/feishu` HTTP 回调。该模式需要公网 HTTPS，且首版不支持 HTTP 加密回调 body；远程办公推荐使用 WebSocket。
