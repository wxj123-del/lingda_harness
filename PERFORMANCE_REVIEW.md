# 性能与资源生命周期审计

## 1. 结论

后端 Session open、terminal、conversation fold 和 active-stream reconnect 的现有 Node benchmark 大多通过；本轮没有证据证明所有后端热点都失控。性能风险集中在 Web/Worker 初始包体、浏览器长会话未完成、Context Router 缺少大历史基线，以及 Electron/Python 发行物没有预算。

## 2. 开放问题

### P-001 [P2] Web 主 bundle 和 WebWorker bundle 超过 500 kB 警戒线

- **文件路径和行号**：Web 入口 `apps/web/src/main.ts:1`、配置 `apps/web/vite.config.ts`；Worker 入口 `packages/experimental/webworker-runtime/src/worker.ts:1-30`；Worker 打包配置 `packages/experimental/webworker-packer/package.json:19-40`。
- **问题描述**：生产构建的 `index` 为 566.15 kB（gzip 196.41 kB），C++ grammar 为 637.59 kB，vendor 为 740.58 kB；Worker `lib/worker.js` 为 705.78 kB（gzip 163.84 kB）。Vite 明确发出 `Some chunks are larger than 500 kB` 警告，grammar/vendor 仍会增加首次 parse/compile 和 Worker boot 成本。
- **影响范围**：首次加载、缓存失效、移动网络、低端设备内存、WebWorker 启动和交互首帧；当前没有 raw/gzip/brotli、parse/execute 和 boot p95 预算，无法判断回归是否可接受。
- **复现或验证依据**：`pnpm run build` 通过，但 `/private/tmp/dsh-audit-20261001-build-final.log:2539-2541,4368-4375` 给出 Worker、主 chunk 和 Vite warning 的精确尺寸。
- **修复建议**：用 bundle analyzer 定位 grammar/vendor 归属；语言 grammar 按需动态导入，稳定 vendor 分包，Worker 只保留运行时依赖；建立 raw/gzip/brotli、请求数、parse/execute、Worker boot p50/p95 阈值，并将预算接入构建 gate。

### P-002 [P2] 长会话浏览器 benchmark 在 Trajectory 阶段失败

- **文件路径和行号**：`benchmarks/long-session-browser/long-session.bench.ts:160-229`，失败步骤在 `:173-176`；Web scaffold teardown 在 `apps/web/tests/scaffold.ts:891-897`。
- **问题描述**：240-turn 历史场景在点击 `Trajectory` 后等待 tab/searchbox/row，30 秒内没有得到目标元素；随后 scaffold teardown 抛 `AggregateError`。因此没有测到 trajectory 搜索、分页、跳转、流式更新的真实 DOM/heap/frame 指标。
- **影响范围**：长 Session 打开耗时、DOM 数量、内存、输入延迟和 streaming frame budget；通过的 Node microbenchmark 不能替代浏览器实际表现。
- **复现或验证依据**：`pnpm run test:bench:built` 返回 40 passed、1 failed；`/private/tmp/dsh-audit-20261001-bench-latest.log:8-71` 明确记录 `getByRole('tab', { name: 'Trajectory' })` 超时和 teardown error。
- **修复建议**：先修复 shipped Web composition/slot/catalog 和稳定 locator，再重新测 cold/warm open、load-earlier、trajectory switch、input p95、JS heap、DOM nodes 和 stream task time；teardown 应保留首个根因，避免二次 `AggregateError` 覆盖诊断。

### P-003 [P3] Context Router 大历史缺少 CPU/heap/p95 基线

- **文件路径和行号**：`packages/context/context-router/src/router.ts:324-385,468-516,560-623,635-746`。
- **问题描述**：一次请求会多次遍历 messages，重复计算 token/词项，构建 tool pairing map，对候选排序，再生成压缩和 audit metadata。输入规模增大时会叠加线性扫描、文本处理和至少一次 `sort`，但当前没有独立的大历史性能证据。
- **影响范围**：10K-50K 消息、tool-heavy transcript、低预算请求的 CPU、GC 和首 token 延迟；性能退化可能先表现为 Web/CLI 超时而非功能错误。
- **复现或验证依据**：上述代码范围可见多处 `forEach`/`filter`/`sort`/token 估算；现有 benchmark 日志没有 context-router p50/p95、分配量或 1K/10K/50K 消息对比，因此这是待量化风险而非已证实超时。
- **修复建议**：缓存每条 message 的 token/词项和 tool pair，合并 evidence/selection/audit 遍历，使用增量索引；增加 1K/10K/50K、不同 tool density、不同 budget 的 CPU/heap/p95 gate，并记录 provider calibration 开销。

### P-004 [P3] Electron/Python 发行物没有包体、冷启动和 RSS 预算

- **文件路径和行号**：`apps/desktop/electron-builder.config.mjs:55-78` 将 `dsh`、`dsh/node_modules` 和 runtime 放入 asar/extraResources；`python/sdk-runtime/package.json:7-136` 定义 runtime deploy root；发行脚本入口在 `package.json:30-45`。
- **问题描述**：构建链能生成 TypeScript/JS artifacts，但本轮没有生成 macOS/Windows Electron 安装包或 Python runtime release bundle，也没有测量压缩体积、重复依赖、冷/热启动、峰值 RSS 和更新差分。
- **影响范围**：下载/安装时间、磁盘占用、自动更新、低内存设备、Python 单文件启动和 native payload 膨胀；JS build 通过不能代表发行物可接受。
- **复现或验证依据**：`pnpm run build` 日志只有 JS bundle 尺寸；没有对应 `package:desktop*` 或 runtime artifact 的尺寸报告，builder 的 `files`/`extraResources` 配置可在 `electron-builder.config.mjs:55-78` 复核。
- **修复建议**：为 macOS arm64/x64、Windows x64 和 Python runtime 生成真实产物，记录压缩体积、重复包、启动 p50/p95、峰值 RSS、更新差分和 native 文件 hash；把预算接入 release workflow。

## 3. 已通过的性能信号与关闭项

- Session first-open、post-upgrade-reopen、first-history、agent-resume，以及 terminal steady/tiny/filtered/5 MiB、conversation fold、active-stream reconnect benchmark 当前通过。
- `packages/subprocess/subprocess-local/src/index.ts:51-86` 已采用 process-wide registry；旧的“每个 runtime 一个 exit listener”问题不再是开放风险。
- 这些信号来自 macOS arm64/Node 24，不能替代 Linux/Windows sandbox、真实 Electron 安装包或真实 provider 网络条件。

## 4. 性能验收顺序

1. 修复 Web assembled composition，使长会话 benchmark 能完成。
2. 建立 Web/Worker 包体和冷启动预算。
3. 对 Context Router 做规模化基准并决定是否需要增量索引。
4. 生成 Electron/Python 真实发行物后再评估下载、启动和内存预算。
