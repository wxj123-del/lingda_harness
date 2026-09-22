# 让飞书成为你的 AI 工作入口：我把一条消息追到了 Agent 内部

项目地址：[XJ-Cyber/lingda-harness](https://gitcode.com/XJ-Cyber/lingda-harness)

很多人第一次接触 Agent 时，都会从浏览器页面开始。但真正进入日常工作后，我们更希望它就在已经使用的工具里：手机上打开飞书，发一条消息，让它查代码、看日志、切换工作模式，再把结果直接发回来。

这篇文章记录的，就是这样一条消息在 DSH 里的完整旅程。

## 一条消息要经过多少站？

可以把它想象成一条小型流水线：

```text
飞书消息
  -> 飞书连接
  -> 安全检查
  -> 找到对应会话
  -> 判断是命令还是普通问题
  -> Context Router 选择需要的上下文
  -> Agent 调用模型和工具
  -> Markdown 回复回到飞书
```

这里最重要的一点是：**不是每条消息都要经过完整的模型流程。**

比如“切换到研究模式”是一条控制命令，它不应该让模型重新搜索工具、读取一大段历史。DSH 会先识别它，直接执行并返回结果。真正需要思考的问题，才会进入 Agent loop。

## 第一步：在飞书里创建一个机器人

在飞书开放平台创建企业自建应用，打开机器人能力，并订阅 `im.message.receive_v1` 事件。应用发布后，测试账号才能找到并使用它。

![飞书开放平台应用配置](https://i-blog.csdnimg.cn/direct/ab7fbcf94425481db6796d469cfd9ded.png)

DSH 默认使用飞书 WebSocket 长连接。它有一个很实际的好处：电脑不需要公网 IP，不需要开放入站端口，也不需要给手机和电脑配置同一个 Wi-Fi。电脑主动连飞书，飞书再把消息送到这条连接上。

如果你的环境已经有公网网关，也可以选择 HTTP Webhook。那时飞书会向：

```text
https://你的域名/feishu
```

发送请求。两种方式进入 DSH 后，后面的会话和 Agent 逻辑是一样的。

## 第二步：启动 DSH，填好连接信息

在项目目录运行：

```sh
pnpm run dsh web --mobile --no-open
```

终端会打印 Web UI 地址。`--mobile` 只是让局域网设备也能访问 Web UI，不是飞书身份验证开关。

![DSH Web 服务启动日志](https://i-blog.csdnimg.cn/direct/bebdaa94794744eba87ca9dd3f88ab9f.png)

打开 **设置 -> 连接服务 -> 飞书机器人**，填写：

- App ID
- App Secret
- 工作区路径
- Agent preset
- Permission preset
- 是否要求群聊必须 @机器人

第一次使用时，权限建议选择 `read-only`。这样机器人可以阅读和分析，但不会立刻拥有修改文件或执行命令的能力。

![DSH 设置中的飞书机器人连接卡片](https://i-blog.csdnimg.cn/direct/ef73a0fef5a7420082a9a3d6c9878ec2.png)

保存后要重启 DSH。只刷新浏览器页面并不会重新建立飞书连接。App Secret 由凭据存储保管，设置文件不会回显密钥内容。

## 第三步：飞书消息怎样进入 DSH？

连接成功后，DSH 会先做一轮“准入检查”：

- 只处理文本消息。
- 忽略空消息。
- 检查私聊发送者是否在 allowlist 中。
- 群聊开启 @要求时，必须 @机器人。
- 过滤重复事件。

HTTP Webhook 还会检查请求是不是 `POST`、是不是 JSON、body 是否超限，以及 Verification Token 和签名是否正确。

![飞书事件订阅与消息入口配置](https://i-blog.csdnimg.cn/direct/ecdbb9c330ba4e5692aedb846a1cc993.png)

这一步的意义是把不符合条件的消息挡在 Agent 之前。模型只处理真正允许进入工作流的内容。

## 第四步：一条消息会进入哪个会话？

DSH 不会把所有飞书聊天混在一起：

- 私聊按发送者 `open_id` 绑定 Agent。
- 群聊按 `chat_id` 绑定 Agent。

这意味着，你和机器人私聊时会有自己的连续会话；一个团队群则共享这个群的会话上下文。

![飞书聊天到 Agent Session 的映射](https://i-blog.csdnimg.cn/direct/fcf22d0ec3b64310a2e5e8ceb13a1785.png)

第一次收到消息时，DSH 会创建工作区、选择 Agent preset、创建 Session、挂载权限，并保存这份绑定。后续消息直接复用它。同一个聊天的两条首消息同时到达，也不会因为竞态创建两个 Agent。

### 有一个需要提前知道的限制

这份聊天到 Session 的绑定目前存在进程内存中。重启 DSH 后，旧日志可能还在，但绑定不会自动恢复。因此，同一个聊天重启后的第一条消息，可能会创建新的 Session，看起来就像“突然开了一个新对话”。

这不是飞书丢数据，而是当前恢复策略还没有把 `chat key -> sessionId` 持久化下来。

## 第五步：命令和普通问题会分开走

这是我觉得最有价值的一层设计。

当你发送：

```text
现在是什么模式
改为编码模式
切换到研究模式
```

DSH 会把这些明确的中文短语映射成 `/mode` 命令，直接调用命令系统。`/mode qa`、`/mode coding`、`/compact` 也走同样的路径。

它们不会启动模型 turn，因此不会因为切换模式而额外消耗一轮模型调用。

![通过飞书发送中文模式指令](https://i-blog.csdnimg.cn/direct/a52e11ac04754790ab722115929e522e.png)

![飞书机器人返回模式切换结果](https://i-blog.csdnimg.cn/direct/2a80b65322a24cabae767133869f49f6.png)

![Web UI 中同步显示当前模式](https://i-blog.csdnimg.cn/direct/10d17b5770e644b7a028b9e266994059.png)

而当你发送：

```text
帮我看看最近一次测试为什么失败
```

它就是普通文本，会创建 user message，进入 Agent loop，交给模型决定是否读取日志、搜索代码或调用其他工具。

## 第六步：Context Router 为什么重要？

普通消息进入 Agent 后，DSH 会组装本次模型请求需要的上下文：

1. 读取当前 Session 历史。
2. 判断哪些上下文与当前问题相关。
3. 选择 system prompt、工具定义、最近消息和任务信息。
4. 调用模型。
5. 根据权限策略执行工具。
6. 持续处理，直到得到最终回复。

这也是上下文路由的意义：完整历史可以继续保存，但不必每次把所有历史原样塞给模型。无关问题可以使用更小的上下文；继续一个长任务时，再召回目标、约束、文件和未解决事项。

飞书接入没有额外塞一份特殊的大提示词，所以飞书和 Web UI 共享同一套 Agent 能力与上下文策略。

## 第七步：回复为什么能显示 Markdown？

Agent 最终产生 `assistant/message` 后，飞书适配器提取其中的文本，并以富文本消息发送，而不是把 `##`、`**` 和代码围栏当成普通字符串发送。

标题、粗体、列表、链接和代码块通常都能正常展示。表格则取决于飞书客户端支持的 Markdown 子集，复杂表格可以改写为列表。长回复会分块发送，当前默认约 4000 字符一段，并优先在换行处切分。

![飞书端渲染后的 Markdown 回复](https://i-blog.csdnimg.cn/direct/bc1d4ec0e0dc4978a5eabf0aa30bbd33.png)

目前回复是在整轮模型处理完成后发送，不是逐 token 流式显示；图片、文件和交互式卡片也还不在这条适配器的转发范围内。

## 如果没有回复，应该先查哪里？

不要一上来就怀疑模型。按照这条顺序检查，通常更快：

1. 飞书应用是否开启机器人能力，并已经发布。
2. 是否订阅 `im.message.receive_v1`。
3. App ID 和 App Secret 是否填写，保存后是否重启 DSH。
4. 日志里是否出现 WebSocket connected。
5. 群聊是否 @机器人。
6. 是否被 `allowedOpenIds` 拦截。
7. 如果是 Webhook，检查 `/feishu`、HTTPS、Verification Token 和 Content-Type。
8. 如果重启后像新对话，确认是否遇到了进程内存映射限制。
9. 如果 Markdown 没有渲染，确认是不是旧的纯文本消息；旧消息不会自动重新渲染。

## 最后说几句安全问题

飞书机器人拥有所选 Agent 的本地工作区权限。建议：

- 从 `read-only` 权限开始。
- 开启写入或执行能力前，限制 `allowedOpenIds`。
- 不要在不受信任的群聊中开放执行型 preset。
- 不要把 App Secret、Verification Token、Encrypt Key 或带 token 的 Web 地址发到公共位置。
- WebSocket 和 Webhook 不要同时订阅同一套消息。

## 写在最后

把 Agent 放进飞书，真正改变的不是“多了一个聊天窗口”，而是工作入口变了：消息可以从手机发出，任务可以在本地工作区执行，结果又回到日常沟通工具里。

从工程实现看，这条链路最关键的三个点是：用 WebSocket 降低接入门槛，用聊天键隔离会话，用命令短路和 Context Router 控制模型成本。

如果你正在搭建自己的 Agent 系统，也可以从这三个问题开始：消息如何安全进入、不同聊天如何隔离、哪些内容真的值得放进下一次模型请求？

项目地址：[https://gitcode.com/XJ-Cyber/lingda-harness](https://gitcode.com/XJ-Cyber/lingda-harness)
