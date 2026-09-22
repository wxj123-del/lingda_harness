# 【实战】把飞书接入 AI Agent：从开放平台配置到 DSH 全链路解析

项目地址：[XJ-Cyber/lingda-harness](https://gitcode.com/XJ-Cyber/lingda-harness)

如果一个 Agent 只能在电脑浏览器里使用，它很难真正进入日常工作流。把飞书接入 Agent 之后，手机上的一条消息可以经过飞书开放平台、DSH、Context Router、工具链和模型，再把结果以富文本消息发回飞书。

本文以 Lingda Harness（以下简称 DSH）当前实现为例，从配置开始，沿着一条真实消息的路径，完整说明飞书机器人是如何工作的。文中默认使用飞书 WebSocket 长连接；HTTP Webhook 作为备用方案介绍。

## 一、先看完整链路

```text
飞书自建应用
    |
    +-- WebSocket 长连接：DSH 主动连接飞书
    |
    +-- HTTP Webhook：飞书 POST /feishu
    |
安全校验、文本过滤、群聊 @检查、重复事件去重
    |
按 open_id（私聊）或 chat_id（群聊）查找 Agent Session
    |
    +-- 控制命令：commands.execute，不启动模型 turn
    |
    +-- 普通文本：agent.followup()
                       |
          Agent loop / Context Router / Tools / Model
                       |
              assistant/message
                       |
             飞书 Markdown 富文本回复
```

这条链路里有六个容易被忽略的事实：

1. WebSocket 模式不需要公网回调地址，DSH 从本机主动连接飞书。
2. HTTP 模式需要公网 HTTPS 地址，并注册精确的 `/feishu` 路由。
3. 私聊按发送者 `open_id` 复用会话，群聊按 `chat_id` 复用会话。
4. `/mode`、`/compact` 等控制命令会在进入模型前执行。
5. 普通文本才进入 Agent loop，回复使用飞书 Markdown 富文本消息。
6. 当前聊天到 Session 的映射保存在进程内存中，重启后下一条消息会创建新 Session。

## 二、在飞书开放平台创建应用

首先创建一个企业自建应用，并启用机器人能力。应用需要满足三个条件：

- 可以作为机器人收发消息。
- 订阅 `im.message.receive_v1` 事件。
- 应用已经发布到当前企业可用的版本，测试账号拥有使用权限。

默认配置使用长连接模式。长连接的好处是 DSH 不需要公网 IP、入站端口或反向代理，电脑只要能够访问飞书 HTTPS/WSS 即可。

![飞书开放平台应用配置](https://i-blog.csdnimg.cn/direct/ab7fbcf94425481db6796d469cfd9ded.png)

### 两种消息传输方式

| 方式 | 消息路径 | 网络要求 | 适合场景 |
| --- | --- | --- | --- |
| `websocket` | DSH 主动建立飞书长连接 | DSH 能访问飞书 HTTPS/WSS | 默认方案、远程办公、无需公网入口 |
| `webhook` | 飞书向 DSH 的 `POST /feishu` 发请求 | DSH 必须有公网 HTTPS | 已有网关或统一回调入口 |

两种方式进入 DSH 后共享同一套会话路由、命令分流和回复逻辑。不要为同一应用同时订阅两条入口，否则同一条消息可能被处理两次。

### 准备凭据

至少需要：

- `App ID`
- `App Secret`

只有 HTTP Webhook 方式额外需要 `Verification Token`。当前适配器不能解密飞书的加密 HTTP callback body，因此首次接入建议使用 WebSocket；如果必须使用 HTTP，应关闭飞书侧的加密回调，或在网关层先完成解密。

## 三、启动 DSH 并配置飞书连接

在项目根目录启动 Web 版 DSH：

```sh
pnpm run dsh web --mobile --no-open
```

只在本机使用时，可以省略 `--mobile`：

```sh
pnpm run dsh web --no-open
```

`--mobile` 只控制 Web UI 是否监听局域网地址，不代表飞书传输方式。启动日志会打印带 token 的访问地址，真实 token 不要发布到公共文档或聊天中。

![DSH Web 服务启动日志](https://i-blog.csdnimg.cn/direct/bebdaa94794744eba87ca9dd3f88ab9f.png)

进入 **设置 -> 连接服务 -> 飞书机器人**，填写以下字段：

| 字段 | 作用 | 建议 |
| --- | --- | --- |
| `App ID` | 飞书自建应用标识 | 必填 |
| `App Secret` | 飞书应用密钥 | 必填，使用只写凭据 |
| `Workspace path` | Agent 读写的本地工作区 | 使用绝对路径 |
| `Agent preset` | 每个飞书会话挂载的 Agent 组合 | 先使用 `standard` |
| `Permission preset` | 文件、命令和审批边界 | 先使用 `read-only` |
| `Require @mention in group chats` | 群聊是否必须 @机器人 | 默认开启 |

App ID 和 App Secret 会写入凭据存储，配置文件只保存凭据引用，不回显 Secret 明文。

![DSH 设置中的飞书机器人连接卡片](https://i-blog.csdnimg.cn/direct/ef73a0fef5a7420082a9a3d6c9878ec2.png)

保存后必须完整重启 DSH。只刷新浏览器不会重新创建飞书连接。重启后，插件会重新读取凭据并创建连接服务。

## 四、DSH 启动时发生了什么

飞书插件会注入以下能力：

- `credentials`：读取 App ID 和 App Secret。
- `agents`：创建 Agent 实例。
- `agentPresets`：挂载 Agent preset。
- `permissionPresets`：设置会话权限。
- `workspaceRegistry`：创建和管理工作区。
- `commands`：执行 `/mode`、`/compact` 等控制命令。

如果凭据还没有准备好，插件会记录等待凭据的日志，不会盲目连接。凭据可用后，WebSocket 模式会建立长连接，并启用：

- 群聊 @策略。
- 私聊 allowlist 策略（配置 `allowedOpenIds` 时）。
- 重复事件去重。
- 单聊天消息队列，避免同一聊天的消息交错处理。

连接建立后，飞书事件会先经过文本类型、空消息、allowlist 和 @规则过滤。HTTP Webhook 还会检查请求方法、JSON Content-Type、body 大小、Verification Token 和签名。

![飞书事件订阅与消息入口配置](https://i-blog.csdnimg.cn/direct/ecdbb9c330ba4e5692aedb846a1cc993.png)

HTTP Webhook 的回调地址是：

```text
https://你的域名/feishu
```

URL 验证成功返回 `200` 和 `challenge`；普通消息接收后尽快返回 `202`，Agent 在后台处理。

## 五、消息如何找到正确的 Agent

收到文本后，插件根据聊天类型计算会话键：

| 聊天类型 | 会话键 | 会话范围 |
| --- | --- | --- |
| 私聊 `p2p` | `open_id` | 同一个发送者复用一个 Agent |
| 群聊 `group` | `chat_id` | 同一个群共享一个 Agent |

例如，内存中的 key 可能是：

```text
open_id:ou_xxx
chat_id:oc_xxx
```

第一次收到消息时，DSH 会创建工作区、解析 Agent preset、读取模型、生成 `feishu-${randomUUID()}` Session ID、挂载权限策略，并把聊天 key 绑定到 Agent。之后同一聊天的消息直接复用该 Agent。

首条消息并发到达时，插件会共享同一个 `pending` 创建 Promise，避免创建两个会话。

![飞书聊天到 Agent Session 的映射](https://i-blog.csdnimg.cn/direct/fcf22d0ec3b64310a2e5e8ceb13a1785.png)

### 重启后的行为

当前聊天 key 到 Session 的绑定只保存在内存中。重启 DSH 后：

- 旧 Session 日志可能还在本地持久化存储中。
- 旧聊天绑定不会自动加载。
- 同一个飞书聊天的下一条消息会创建新的随机 Session。

因此，重启后表现为“新对话”，并不是飞书丢失了聊天记录。要实现自动续接，需要额外持久化 `chat key -> sessionId` 映射，并在启动时安全 resume。

## 六、控制命令为什么不会触发模型

这是本次链路中最值得关注的优化。

下面这些输入会在 Agent loop 之前直接执行：

```text
/mode qa
/mode coding
/compact
```

执行路径是：

```text
Feishu text -> resolve command -> commands.execute -> command result -> Feishu
```

它不会调用 `agent.followup()`，不会启动模型 turn，也不会因为一条简单的模式切换消息触发工具搜索。

未注册的 slash command 也不会被当作普通问题发送给模型，而是直接返回未知命令。为了方便移动端使用，以下明确的中文短语也会映射到 `/mode`：

```text
现在是什么模式
改为编码模式
切换到研究模式
进入执行模式
```

![通过飞书发送中文模式指令](https://i-blog.csdnimg.cn/direct/a52e11ac04754790ab722115929e522e.png)

![飞书机器人返回模式切换结果](https://i-blog.csdnimg.cn/direct/2a80b65322a24cabae767133869f49f6.png)

![Web UI 中同步显示当前模式](https://i-blog.csdnimg.cn/direct/10d17b5770e644b7a028b9e266994059.png)

普通文本则走另一条路径：

```text
Feishu text
  -> createUserMessage()
  -> source.kind = feishu
  -> agent.followup()
  -> Agent loop
```

飞书来源、event ID 和聊天摘要保存在消息来源元数据中，不会额外拼成一份隐藏提示词。

## 七、普通消息如何进入 Agent 和 Context Router

普通消息进入 Agent 后，通用 Agent 栈会完成以下工作：

1. 读取当前 Session 历史。
2. 经过 Context Router 和上下文裁剪、汇总逻辑。
3. 组装 system prompt、工具定义、最近消息和任务相关上下文。
4. 调用当前模型。
5. 执行工具调用，并按 permission preset 拦截高风险操作。
6. 继续模型步骤，直到得到最终回复、出错或取消。

飞书适配器不会为普通聊天额外注入一份“飞书专用大提示词”。因此，飞书和 Web UI 共享同一套 Agent 能力、权限边界和上下文处理逻辑。

## 八、回复如何回到飞书

插件监听 `assistant/message` 事件，只提取文本 block。当前适配器不会把图片、文件或交互式卡片转发到飞书。

回复不是普通的 `msg_type: text`，而是 Markdown 富文本：

- WebSocket 模式调用 SDK 的 `{ markdown: text }`。
- HTTP 模式发送 `msg_type: post`，内容使用 `zh_cn.content = [[{ tag: 'md', text }]]`。

标题、粗体、列表、链接和围栏代码块会交给飞书 Markdown 渲染器处理。表格效果取决于飞书客户端支持的 Markdown 子集；复杂表格建议改写成列表。长回复默认按约 4000 字符分块，并优先在换行处切分。

当前是整轮完成后发送，不是逐 token 流式发送。

![飞书端渲染后的 Markdown 回复](https://i-blog.csdnimg.cn/direct/bc1d4ec0e0dc4978a5eabf0aa30bbd33.png)

## 九、命令行配置方式

除了 Web UI，也可以使用 overlay：

```yaml
- insert:
    - id: feishu-bot
      name: '@deepseek-ai/dsh-webhook-feishu'
      config:
        transport: websocket
        path: /feishu
        appIdEnv: DSH_FEISHU_APP_ID
        appSecretEnv: DSH_FEISHU_APP_SECRET
        workspacePath: !!js process.env.DSH_FEISHU_WORKSPACE ?? process.cwd()
        agentPreset: standard
        permissionPreset: read-only
        source: primary-feishu
        maxBodyBytes: 1048576
        requireMention: true
        allowedOpenIds: []
```

然后导出凭据并启动：

```sh
export DSH_FEISHU_APP_ID='cli_xxx'
export DSH_FEISHU_APP_SECRET='replace-with-app-secret'
export DSH_FEISHU_WORKSPACE='/path/to/workspace'
pnpm run dsh web --patch apps/cli/config/examples/feishu-bot/cordis.yml
```

HTTP 模式还需要：

```yaml
transport: webhook
verificationTokenEnv: DSH_FEISHU_VERIFICATION_TOKEN
```

不要把 App Secret、Verification Token、Encrypt Key 或带 token 的 Web URL 提交到 Git、截图或公共文章。

## 十、遇到问题怎么排查

建议按照消息链路从前到后检查：

| 现象 | 优先检查 |
| --- | --- |
| 找不到机器人 | 机器人能力、应用发布状态、测试账号权限 |
| DSH 一直等待凭据 | App ID/App Secret 是否配置，配置后是否重启 |
| 没有 WebSocket connected 日志 | 出站网络、长连接模式、App Secret |
| Webhook 返回 401/415/413 | Verification Token、Content-Type、body 大小 |
| 私聊能用，群聊没反应 | 是否 @机器人、`requireMention` 是否开启 |
| 只有部分人能用 | `allowedOpenIds` 是否包含发送者 `open_id` |
| 重启后像新对话 | 当前会话映射是进程内存，属于已知限制 |
| `##` 和 `**` 原样显示 | 是否是新回复，旧 text 消息不会自动重渲染 |
| 收到 Agent 错误 | 模型凭据、Agent preset、权限策略和工作区路径 |

## 十一、安全边界和当前限制

远程接入建议先使用 `read-only` permission preset。需要写文件或执行命令时，先配置 `allowedOpenIds`，不要在不受信任的群聊中直接开放执行型权限。

当前限制包括：

- 聊天到 Session 的映射重启后不会自动续接。
- HTTP 加密 callback body 当前不能由适配器解密。
- 回复只转发文本，不转发图片、文件和交互式卡片。
- 回复在完整模型 turn 后发送，没有流式增量消息。
- WebSocket 和 Webhook 不应同时订阅同一消息入口。

## 十二、总结

飞书接入 Agent 的关键，不是简单增加一个消息发送接口，而是把“接收、准入、会话、上下文、工具、模型、回复”串成一条可解释的链路。

在 DSH 中，控制命令会在模型前短路，普通消息才会经过 Context Router 和 Agent loop；私聊与群聊拥有不同的会话键；最终回复通过飞书 Markdown 富文本返回。理解这几个边界后，配置、排错和后续扩展都会简单很多。

项目地址：[https://gitcode.com/XJ-Cyber/lingda-harness](https://gitcode.com/XJ-Cyber/lingda-harness)

**关键词：** 飞书机器人、AI Agent、DeepSeek Harness、Context Router、WebSocket、Webhook、Markdown、TypeScript
