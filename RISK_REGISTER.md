# 风险登记表

## 1. 风险总览

本表只登记当前工作树仍开放的问题。严重度定义遵循本次审计要求：P0 为阻断运行或重大安全问题，P1 为严重功能/稳定性问题，P2 为一般质量/维护问题，P3 为优化建议。

| 严重度 | 数量 | 发布要求 |
| --- | ---: | --- |
| P0 | 0 | 本轮未确认 |
| P1 | 2 | 发布前必须关闭并有物理效果/消费者回归证据 |
| P2 | 6 | 发布前关闭，或由明确 owner 书面接受有期限的残余风险 |
| P3 | 5 | 纳入维护/性能/依赖计划并建立量化基线 |
| **合计** | **13** | 均为当前开放状态 |

## 2. P1 风险

### A-001 [P1] assembled child 绕过 read-only 文件策略

- **文件路径和行号**：`apps/cli/tests/profiles/headless/tests/subagent-inheritance.expected.e2e.ts:95-120`；`packages/subagent/subagent-in-process-driver/src/index.ts:117-143`；`packages/subagent/subagent/src/child-agent.ts:246-275`；`packages/sandbox/sandbox-policy/src/index.ts:164-180`；`packages/fs/fs-sandbox/src/index.ts:122-143`。
- **问题描述**：父 Session 的 `read-only` override 已被记录，但真实 assembled child 仍执行了文件写入；日志策略与物理效果不一致。
- **影响范围**：CLI/SDK/Web 的 in-process subagent、workspace 源码和配置、权限审计与 Session 恢复。
- **复现或验证依据**：聚焦 expected 测试稳定得到 `promise resolved "escaped" instead of rejecting`，`inherited.txt` 实际存在。
- **修复建议**：逐层核对 child Context/provider/projection identity；mutation 前强制从 child Session 解析 policy；缺失时 fail-closed；补 assembled、resume 和跨平台负向写入测试。
- **建议 owner / 状态**：Security + Subagent + Sandbox；**开放，发布阻断**。

### T-001 [P1] 发布消费者验证没有形成绿基线

- **文件路径和行号**：`package.json:55-76,80-89`；`scripts/run-gates.ts:483-520,658-674,801-828`；`apps/web/tests/scaffold.ts:891-897`。
- **问题描述**：expected、snapshot、built Web、built-bin 和 benchmark 等消费者面同时失败，且混有真实行为回归、timeout、unhandled rejection 和 golden 漂移。
- **影响范围**：CLI、SDK、Web、Session replay、plain-Node package import 和安装后用户行为。
- **复现或验证依据**：`pnpm run check:ci:consumers` 退出 1；snapshot 为 129 failed，expected 为 16 failed，Web 有大量 30 秒 timeout，benchmark 为 40/41。
- **修复建议**：按安全策略、Session/fixture、assembled composition、Web teardown 分组修复；禁止批量刷新 golden；要求 unexpected failure、unhandled rejection、teardown error 为零。
- **建议 owner / 状态**：Release + QA + 各模块 owner；**开放，发布阻断**。

## 3. P2 风险

### Q-001 [P2] 276 条 lint error

- **文件路径和行号**：`packages/media/image-generation/src/tool.ts:30,85`、`packages/schedule/schedule/src/domain.ts:413`、`packages/schedule/schedule/src/service.ts:120,201`、`packages/webhook/webhook-feishu/src/index.ts:127,318-328` 等。
- **问题描述**：存在 unsafe 值、deprecated API、隐式 eval、错误回调未收窄、非空断言和无效条件等 276 条错误。
- **影响范围**：生产 webhook/media/schedule、Client workflow 和测试 mock 的类型/错误处理可信度。
- **复现或验证依据**：`pnpm lint` 非零退出；`/private/tmp/dsh-audit-20261001-lint-final2.log` 可数得 276 条 error，约 75 个文件。
- **修复建议**：生产边界优先，显式解析 `unknown`，移除隐式执行和 deprecated API；禁止全局 disable。
- **建议 owner / 状态**：各 package owner；开放。

### Q-002 [P2] 251 项公共导出 JSDoc 缺失

- **文件路径和行号**：`packages/client/ui-layout/src/authoring-settings.ts:3-9,106-134`、`packages/context/context-router/src/router.ts:145,193,216,748`、`packages/host/knowledge/src/types.ts:4-90`、`packages/webhook/webhook-feishu/src/feishu.ts:12-103` 等。
- **问题描述**：公共类型、函数和方法缺少说明、`@param`、`@returns` 或显式 return type，唯一剩余的 static gate 因此失败。
- **影响范围**：SDK/插件消费者、API review、Typert/catalog 生成和文档发布。
- **复现或验证依据**：`pnpm run check:ci:static` 为 56 passed / 1 failed；`verify-export-jsdoc` 报 251 项。
- **修复建议**：补真实行为契约和参数/返回语义，重新运行生成器、doc typecheck 和 static gate；禁止空模板注释。
- **建议 owner / 状态**：API + Docs + package owner；开放。

### T-002 [P2] coverage 范围和 per-file 100% 门槛不可操作

- **文件路径和行号**：`vitest.config.ts:204-366`，尤其排除项 `:223-353` 和 threshold `:354-366`；`package.json:55-58`。
- **问题描述**：高 aggregate 仍因纳入文件逐项 100% 失败，同时大量 Client/Worker/inspector 文件被排除，缺少 owner、债务比例和到期计划。
- **影响范围**：浏览器、Worker、权限、迁移、Remote 解码和跨平台代码的覆盖判断与趋势比较。
- **复现或验证依据**：24,711 tests 通过，aggregate 97.59/95.77/97.70/98.08%，但命令因多文件低于 100% 退出 1。
- **修复建议**：按 Host/Client/Worker/process/Python 分区；为排除项增加 owner/review date；关键安全路径采用分支和负向行为门槛。
- **建议 owner / 状态**：Test Infrastructure；开放。

### P-001 [P2] Web/Worker bundle 过大

- **文件路径和行号**：`apps/web/src/main.ts:1`、`apps/web/vite.config.ts`、`packages/experimental/webworker-runtime/src/worker.ts:1-30`。
- **问题描述**：Web index 566.15 kB、C++ grammar 637.59 kB、vendor 740.58 kB、Worker 705.78 kB，Vite 发出大 chunk warning。
- **影响范围**：首次加载、parse/compile、缓存、移动网络、Worker boot 和低端设备内存。
- **复现或验证依据**：`/private/tmp/dsh-audit-20261001-build-final.log:2539-2541,4368-4375`。
- **修复建议**：按需加载 grammar、稳定 vendor 分包、缩小 Worker closure，并建立 raw/gzip/parse/boot p95 预算。
- **建议 owner / 状态**：Web + Build；开放。

### P-002 [P2] 长会话浏览器 benchmark 未完成

- **文件路径和行号**：`benchmarks/long-session-browser/long-session.bench.ts:160-229`，失败在 `:173-176`；`apps/web/tests/scaffold.ts:891-897`。
- **问题描述**：240-turn 场景找不到 `Trajectory` tab，随后 teardown 抛 `AggregateError`，没有产出 UI/heap/frame 指标。
- **影响范围**：长 Session 打开、分页、trajectory、输入延迟、流式渲染和内存。
- **复现或验证依据**：benchmark 40 passed / 1 failed，locator 30 秒 timeout。
- **修复建议**：先修 Web composition/locator，再测 cold/warm p50/p95、heap、DOM nodes、input 和 streaming；保留首个 teardown 根因。
- **建议 owner / 状态**：Web + Performance；开放。

### D-001 [P2] 发行物许可证闭包未核准

- **文件路径和行号**：`THIRD_PARTY_NOTICES.md:28-36,128-149,152-230`、`apps/desktop/electron-builder.config.mjs:61-78`、`python/sdk-runtime/package.json:7-136`。
- **问题描述**：535 条生产闭包中有 Unknown 3、LGPL 1、MPL 5、`MIT AND MPL-2.0` 1，尚未按 npm/Python/Electron 平台产物证明实际分发义务。
- **影响范围**：native payload、动态链接、source/notice 提供义务和公开发布合规。
- **复现或验证依据**：`/private/tmp/dsh-audit-20261001-prod-licenses.json`；notices freshness 通过但只覆盖声明，不是最终 artifact closure。
- **修复建议**：逐产物生成 SPDX/CycloneDX SBOM、bundled-file 清单和 LICENSE/NOTICE，补 Unknown 条款确认并在 CI 做 diff。
- **建议 owner / 状态**：Legal + Release；开放。

## 4. P3 风险

### Q-003 [P3] 18 组重复代码

- **文件路径和行号**：`packages/client/ui-layout/src/client/authoring/SkillEditor.tsx:14-37` 与 `ToolEditor.tsx:13-33`，以及 `packages/webhook/webhook-feishu/src/handler.ts:29-37` 与 GitHub handler 等。
- **问题描述**：18 组 clone、231 行重复，集中在平行 UI、webhook、media 和 context-router。
- **影响范围**：维护成本和修复分叉。
- **复现或验证依据**：`pnpm run duplication` 失败，总重复率约 0.06%。
- **修复建议**：只抽取语义相同的小 helper，保留领域差异并补共享行为测试。
- **建议 owner / 状态**：各 package owner；开放。

### P-003 [P3] Context Router 缺少大历史性能基线

- **文件路径和行号**：`packages/context/context-router/src/router.ts:324-385,468-516,560-623,635-746`。
- **问题描述**：同一请求多次扫描/tokenize/sort messages，目前没有 1K/10K/50K 的 CPU、heap、p95 数据。
- **影响范围**：tool-heavy 长历史的首 token 延迟和 GC。
- **复现或验证依据**：代码路径可见多次遍历和排序，benchmark 中没有对应指标。
- **修复建议**：缓存 token/词项/tool pair，建立不同规模和 budget 的 benchmark 后再决定是否做增量索引。
- **建议 owner / 状态**：Context + Performance；待量化。

### P-004 [P3] Electron/Python 缺发行物性能预算

- **文件路径和行号**：`apps/desktop/electron-builder.config.mjs:55-78`、`python/sdk-runtime/package.json:7-136`、`package.json:30-45`。
- **问题描述**：没有真实安装包/runtime bundle 的压缩体积、重复依赖、冷启动、RSS 和更新差分报告。
- **影响范围**：下载、安装、磁盘、启动、自动更新和低内存设备。
- **复现或验证依据**：本轮 build 只有 JS bundle 尺寸，未执行平台 package 命令。
- **修复建议**：生成 macOS arm64/x64、Windows x64、Python runtime 产物并建立预算 gate。
- **建议 owner / 状态**：Release + Performance；待量化。

### D-002 [P3] 依赖例外缺少 owner/expiry/hash

- **文件路径和行号**：`pnpm-workspace.yaml:39-108`；3 个 `patches/*.patch:1`。
- **问题描述**：allowBuilds、minimumReleaseAgeExclude 和 patchedDependencies 没有统一生命周期元数据。
- **影响范围**：install-time code、native binary、升级和 patch 退役审查。
- **复现或验证依据**：YAML 可见 20 余个 release-age 例外和 3 个 patch；现有 gate 不检查到期。
- **修复建议**：增加 owner、理由、批准/到期日期、上游 hash，过期让 CI 失败。
- **建议 owner / 状态**：Supply Chain；开放。

### D-003 [P3] 24 个开发依赖落后 latest

- **文件路径和行号**：`package.json:201-248`。
- **问题描述**：Vitest、TypeScript、jsdom、oxlint、tsdown、mermaid 等 24 项落后最新版本。
- **影响范围**：测试、类型、bundler 和文档工具的 bugfix/兼容升级成本。
- **复现或验证依据**：`/private/tmp/dsh-audit-20261001-outdated-latest.json` 共 24 条。
- **修复建议**：按工具栈分批升级，major 独立验证；每批重跑 snapshot、publint、catalog 和 consumer。
- **建议 owner / 状态**：Developer Infrastructure；开放。

## 5. 建议关闭顺序

1. A-001：先恢复实际最小权限。
2. T-001：恢复全部发布消费者基线。
3. Q-001、Q-002、T-002：恢复代码/文档/coverage 门禁。
4. P-001、P-002、D-001：补性能与发行物合规证据。
5. Q-003、P-003、P-004、D-002、D-003：纳入有 owner 和期限的维护计划。

风险只有在源码修复、聚焦回归、所属 aggregate gate 和目标发行物 smoke 全部通过后才能关闭。更新 golden、忽略 lint、提高 warning limit 或只在 workspace symlink 下验证，均不足以关闭对应风险。
