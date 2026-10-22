# 测试覆盖率与验证体系审计

## 1. 测试体系

测试入口集中在 `package.json:55-95`，包含普通 Vitest、coverage、真实 API E2E、snapshot、expected、built Web、consumer smoke、benchmark、静态 gate、Python pytest 和 native/build smoke。分层设计合理：Session replay、owner-local expected 和 plain-Node built consumer 没有被单元测试完全替代。问题在于当前工作树的发布相关层同时有失败，而且部分失败包含 unhandled rejection 和 teardown error，不能按“只是 golden 漂移”处理。

## 2. 执行结果

| 测试面 | 最新可用结果 |
| --- | --- |
| `pnpm run test:coverage` | 1,433 files passed；24,711 passed、1 expected fail、135 skipped；aggregate statements 97.59%、branches 95.77%、functions 97.70%、lines 98.08%；因 per-file 100% threshold 失败退出 1 |
| `pnpm run test:e2e` | 4 files failed；16 failed、144 passed、104 skipped |
| `pnpm run test:snapshot` | 4 files failed；129 failed、24 passed、2 skipped |
| `pnpm run test:expected` | 7 files failed；16 failed、75 passed；其中 child read-only 复现为真实写入成功 |
| `pnpm run test:web:built` | settings、composer geometry、navigation、live interactions、lifecycle、sidebar 等 suite 失败或超时，并捕获 unhandled rejection/teardown error |
| `pnpm run test:bench:built` | 40 passed、1 failed；长会话 browser benchmark 等待 `Trajectory` 30 秒超时 |
| CPython 3.10 PTC 聚焦复测 | 250 passed、2 skipped |
| Python SDK pytest | 112 passed、7 skipped |
| `pnpm run check:ci:consumers` | built-bin smoke、expected、snapshot、web browser snapshot 等未全绿；最终 gate 退出 1 |

证据：`/private/tmp/dsh-audit-20261001-coverage-final3.log`、`...e2e-latest.log`、`...snapshot-latest.log`、`...expected-latest.log`、`...bench-latest.log`；消费者 gate 定义在 `scripts/run-gates.ts:483-495,801-828`。

## 3. 开放问题

### T-001 [P1] 发布消费者验证没有形成可发布基线

- **文件路径和行号**：脚本入口 `package.json:55-76,80-89`；聚合依赖图 `scripts/run-gates.ts:483-495`；snapshot/expected/Web/built-bin gate 分别在 `scripts/run-gates.ts:498-520,658-674,801-828`；Web teardown 汇总在 `apps/web/tests/scaffold.ts:891-897`。
- **问题描述**：unit/coverage、E2E、snapshot、expected、built Web、built-bin 和 benchmark 不能同时通过。失败集合同时包含真实行为问题（A-001 child write、connection loss、模型/工具轮次超时）和已变更 UI/catalog/session 事件造成的 golden 漂移；当前不能从局部通过推断 CLI、SDK、Web 或 Session replay 可发布。
- **影响范围**：用户任务发送、历史恢复、权限执行、浏览器导航/trajectory、plain-Node package imports、安装后消费者以及 CI 回归判定。发布后可能出现源码面通过、发行物面失败。
- **复现或验证依据**：本轮 `pnpm run check:ci:consumers` 最终失败，输出列出 `built-bin smoke`、`test:expected`、`test:snapshot`、`web browser snapshot`；独立 `test:expected` 中 `subagent-inheritance` 在 `apps/cli/tests/profiles/headless/tests/subagent-inheritance.expected.e2e.ts:119` 确认 physical write；built Web 日志有 30 秒超时、`no turn/end within 30000ms`、`AggregateError` 和 `page closed` unhandled errors。
- **修复建议**：先按安全策略、Session/fixture、assembled composition、Web teardown 四类根因分组；对每类建立最小聚焦测试，再运行完整 consumer aggregate。禁止批量刷新 golden 来掩盖行为或安全变化；发布门槛应要求 unexpected failure、unhandled rejection、teardown error 和 mock server exhaustion 均为零。

### T-002 [P2] coverage gate 的纳入范围和逐文件门槛未形成可操作的覆盖率基线

- **文件路径和行号**：coverage include/exclude/threshold 在 `vitest.config.ts:204-366`；入口脚本在 `package.json:55-58`；大量 client/worker/inspector 排除项见 `vitest.config.ts:223-353`。
- **问题描述**：最终 coverage 已能产生 aggregate，但配置对所有纳入文件强制 statements、branches、functions、lines 四项 100% per-file threshold，导致高 aggregate 仍以 exit 1 失败；同时大量真实生产路径以 GUI/Worker/inspector 债务排除，未报告其占生产代码的比例、owner、目标测试和复审日期。
- **影响范围**：无法用一个可比较的数字判断浏览器、Worker、权限、迁移、Remote 解码和跨平台执行路径的覆盖质量；严格门槛又会把新功能交付变成“补空分支”而不是补关键负向行为。
- **复现或验证依据**：`/private/tmp/dsh-audit-20261001-coverage-final3.log:285-294,4653-4656` 显示 24,711 tests passed、aggregate 97.59/95.77/97.70/98.08%，但日志仍列出大量文件未达到 100%，命令以 exit 1 结束；排除清单可直接从 `vitest.config.ts:212-353` 读取。
- **修复建议**：按 Host、Client/jsdom、WebWorker、process/native、Python 分区生成 coverage；对每个排除项记录 owner、理由、目标测试和复审日期；对 sandbox、Session migration、Remote boundary 和 persistence corruption 设分支/负向门槛，保留 per-file 100% 作为已覆盖小模块的局部规则，而非全仓唯一发布信号。

## 4. 已关闭的测试环境噪声和剩余缺口

- 早期普通 `pnpm test` 受到 PATH 中 CPython 3.9.6 影响，重复报 `must be CPython 3.10 or newer`；解释器解析/fallback 已加入，CPython 3.10 聚焦 lane 通过，不再登记为产品缺陷。CI 仍应固定 3.10+，并在日志首部打印 Node、pnpm、Python、浏览器和 native backend 版本。
- 当前未在本机证明 Linux/Windows sandbox backend、签名 Electron 安装包、真实 provider key、升级安装和跨平台 Python runtime。
- Session 历史 corpus 仍需保持 v0-v4、seed/resume、read-only、append、reopen、corrupt/torn tail 和 built worker 的物理效果断言。
- Web gate 应将 unhandled rejection、teardown `AggregateError` 和长会话性能失败作为硬失败，而不是只输出 warning。

## 5. 建议验收顺序

1. 先以单测复现并关闭 A-001。
2. 分离环境失败与产品失败，修复 consumer gate 的首个根因。
3. 建立 partitioned coverage 和排除项清单。
4. 最后重跑 E2E、snapshot、expected、built Web、built-bin 和 benchmark 全矩阵。
