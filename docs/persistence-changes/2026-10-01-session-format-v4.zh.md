---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-01-session-format-v4

[English](2026-10-01-session-format-v4.md) | 中文

## 概述

当前 Session writer 从格式 v3 升级到 v4。本次发布保留 V3 的物理 framing 与事件时序，同时确认新增的 Feishu 消息来源变体、workflow schedule version 2 载荷，以及当前 writer header version。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-01-session-format-v4
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-11-initial"
    after: "1a3440e3577382704d42a6263aa463504eb74c566734a55e9503a63efcd02445"
    decision: version-bump
  - root: "event:agent/git-checkpoint"
    previous: null
    after: "c555ad0edd8ac898d69feea20b054aa1720d2efa4ae4b65be69f5b2ae0913c70"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-14-image-offload"
    after: "114fd6c87df77706e92e7e38e18092653ca092cb785d37e9bc087bb5c97e16ae"
    decision: version-bump
  - root: "event:agent/mode"
    previous: null
    after: "b35ceaaccf4e97b9051dce0f8d2caaef86abe66012a42c01b076f1a3a3fc6faa"
    decision: version-bump
  - root: "event:agent/request-context"
    previous: null
    after: "bbae7a06c6d6a0c6d564389db65fe37975ae248152c931d04b59da9d6e16035a"
    decision: version-bump
  - root: "event:agent/tool-denied"
    previous: null
    after: "95a88c6c191f903e893fb0f2cc59d22267e8e81aa1ab62ed1ba064811bc439f7"
    decision: version-bump
  - root: "event:context/calibration"
    previous: null
    after: "49095060824d56fc0f640ea2c29ca9e43cc7b9c04deeadf1e179e7092e11fb1d"
    decision: version-bump
  - root: "event:context/router"
    previous: null
    after: "bb7fe4c07667dd19ddaf95f78a457ac33af270c756c35a9116b6eff357cebec2"
    decision: version-bump
  - root: "event:knowledge/retrieval"
    previous: null
    after: "0c54f7f4cb8eda46c3e4818f5297f93f382dc251a95d49e21b0171333cb4bffd"
    decision: version-bump
  - root: "event:knowledge/selection"
    previous: null
    after: "fb1388960c87089798fe6f094a0ad0afaed619f13cdf7b138aa1f452fcd510c5"
    decision: version-bump
  - root: "event:schedule/change"
    previous: "2026-09-11-initial"
    after: "6994abb4371f4ed5044d3feb0a492a2050237563e6d26c6cf3e9d9d94857103c"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-14-image-offload"
    after: "71525775c8828e00ba831ceab8140fe0828ee62c26b7c2e9a56eb7e883217928"
    decision: version-bump
  - root: "event:task/cancelled"
    previous: null
    after: "c2517349361edf26b29f088bbb2b3dc4a255d6f98cf5845492c679c52ff1cef4"
    decision: version-bump
  - root: "event:task/created"
    previous: null
    after: "a5c054e888fe194baa2ff9ede075fa0724041e964784ab12e16be2f440af05f1"
    decision: version-bump
  - root: "event:task/failed"
    previous: null
    after: "1969f58989122497d3d8e1731940f7b34b2bf015441fd72a6afd2f06c4693538"
    decision: version-bump
  - root: "event:task/planned"
    previous: null
    after: "4aa65dac12a686eeaeeabc727b383da3d8619c5ff0c98a9bc6aa0e4c420eaed1"
    decision: version-bump
  - root: "event:task/running"
    previous: null
    after: "2dde4581e88305e75afe04f8dde5b601b09be267131b7cce1a5c78f8be916c72"
    decision: version-bump
  - root: "event:task/succeeded"
    previous: null
    after: "052e010d8aacaf68bff0313a0e25bf21d21395010ffd3320b23260017751cf3e"
    decision: version-bump
  - root: "event:task/waiting-human"
    previous: null
    after: "a4d4b0db312ffa29b34e21c22f1f7bcf32305b447f5c2220edab34bce18ec765"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-14-image-offload"
    after: "33d7360537702223e68e495f2b05befe9692cc7724837ec3b4fbe897bae468ca"
    decision: version-bump
  - root: "event:visual-workflow/node"
    previous: null
    after: "ff2ee66479a0a60bd141972b78adf9c8bfca4b36d262ca17c8c234f15d78dc76"
    decision: version-bump
  - root: "event:visual-workflow/run"
    previous: null
    after: "e5f1783273336e038605b79bbb69e2e569cf19f9ba8f3d604672ffb1b0f0dbc2"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

读取器必须先通过相邻的 v3 到 v4 身份迁移，再执行当前 Session validator。迁移保留事件身份、载荷、来源坐标和继承切点；V4 校验接纳经过审计的 Feishu source 形状与 workflow schedule 载荷，但不重写它们。V3 文件仍可通过完整的 v0 到 v4 链读取，而标记为更高版本的文件仍会被拒绝。

<a id="verification"></a>
## 验证

已通过生成的 persistence catalog、v3 到 v4 codec 与 migration 测试、Feishu 物理往返覆盖、workflow schedule 还原覆盖、TypeScript 项目检查和 persistence-change verifier。V4 writer 与 catalog 都从同一个当前版本声明生成；该确认记录包含必需的递增 SessionHeader.version 迁移。

<a id="dev-note"></a>
## 开发备注

无。
