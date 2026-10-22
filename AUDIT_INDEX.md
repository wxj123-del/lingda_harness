# DeepSeek Harness 全面审计索引

## 1. 审计结论

- **审计日期**：2026-10-01。
- **审计对象**：`/Users/von/wxj/my_project/DSH/deepseek-harness` 当前工作树。
- **修改边界**：初始审计阶段只生成报告；随后针对审计发现做了最小修复和回归验证，涉及委派权限继承、Context Router 临时调试代码、工具结果去重和 provider-retry 测试 fixture。开始审计时工作树已有大量未提交变更，因此结论针对当前工作树，不代表干净提交。
- **健康度**：**55/100，中低**。A-001 的 assembled read-only 物理越权已修复并通过聚焦回归，类型编译、基础构建、生产依赖漏洞门禁和多数文档/发布卫生检查通过；但消费者发布门禁仍未形成绿基线，代码质量和 coverage 门禁也未全绿。
- **发布判断**：**适合继续修复性开发，不适合发布**。在 `T-001` 关闭并完成目标发行物 smoke、跨平台权限回归和基线重建前，不应发布 CLI、SDK、Web、Electron 或 Python runtime。
- **P0**：本轮未确认 P0。A-001 已关闭；仍有 P1 的消费者发布基线风险。

## 2. 目录、入口、配置和依赖清单

### 2.1 顶层目录

`apps/`（CLI、Web、Electron）、`packages/`（53 个能力组）、`python/`（SDK/runtime）、`native/`（平台 addon）、`vendor/`（Cordis 源码）、`scripts/`（构建器和 gate）、`docs/`、`website/`、`benchmarks/`、`snapshots/`、`examples/`、`distribution/`、`patches/`、`.github/`、`.gitlab-ci.yml`。

### 2.2 技术栈与规模

| 项目 | 审计事实 |
| --- | --- |
| 包管理 | pnpm workspace，`pnpm@11.7.0`；定义在 `package.json:7`、`pnpm-workspace.yaml:1-15` |
| Node | `^22.19.0 || >=24.0.0`；本次执行 `v24.18.0`；`package.json:8-10` |
| 语言 | TypeScript/TSX、ESM JavaScript、Python、C/native addon |
| UI/构建 | React、Vite、Electron、VitePress、tsdown、TypeScript project references |
| 核心框架 | Cordis Context/Plugin、Service Definition/Provider/Consumer、Typert Host/Client projection |
| 测试 | Vitest、Playwright、Node test、pytest、snapshot、expected、built-consumer、benchmark lanes |
| workspace | `pnpm -r list --depth -1` 得到 321 个条目（含根），其中 303 个 `@deepseek-ai/dsh-*` 包；`publint` 覆盖 298 个 `packages/*/*` 包 |
| 锁定 | `pnpm-lock.yaml` lockfile v9；Python 依赖由 `python/sdk/uv.lock` 固定版本和 hash |
| 包组覆盖 | `packages/` 一级目录共 53 组；每组均检查 manifest、入口、依赖方向和对应静态 gate/测试入口 |

### 2.3 入口文件

| 产品/边界 | 入口和配置 |
| --- | --- |
| CLI `dsh` | `apps/cli/package.json:14-16` -> `apps/cli/src/bin.ts` |
| Web | `apps/web/src/main.ts`、`apps/web/src/preview.ts`、`apps/web/vite.config.ts` |
| Electron | `apps/desktop/src/main.ts`、`apps/desktop-host/src/index.ts`、`apps/desktop/electron-builder.config.mjs:55-78` |
| Python SDK/runtime | `python/sdk/src/deepseek_harness`、`python/sdk-runtime/runtime-bootstrap.mjs:1-24` |
| Native | `native/system/src`、`native/system/scripts/build.ts` |
| 文档站 | `website/build.ts:72-85`、`website/vite.config.ts` |
| Host/Client 聚合 | `tsconfig.host.json`、`tsconfig.client.json`、`scripts/build.ts:31-50` |

### 2.4 已检查的配置面

根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig*.json`、`tsdown.config.ts`、`vitest*.config.ts`、`.oxlintrc*.json`、`lefthook.yml`、`.github/workflows/`、`.gitlab-ci.yml`、Python `pyproject.toml`/`uv.lock`、Electron builder/native/vendor manifests，以及所有 workspace manifest 的 `exports`、`files`、`dependencies`、`publishConfig`。

### 2.5 构建、部署和文档判断

- 构建链支持 Host/Client library、Web、Electron、Python runtime 和 native addon；`pnpm run build`、typecheck、Node compatibility、publint、built invariants、doc typecheck 通过。
- 发布脚本位于 `package.json:23-45,190-193`；本轮没有执行签名 Electron 安装包、Windows/Linux sandbox 矩阵或真实 Python runtime 发布包，因此这些面仍是发布前验证项。
- `pnpm-workspace.yaml:39-108` 对 lifecycle script、release-age 和 patch 有正向控制，但例外生命周期治理不足，详见 `DEPENDENCY_REVIEW.md:D-002`。
- 文档站、Markdown links/wrap、双语 pairing、README summary/model-experience、Agent Note、repository reference 和 doc graphs 门禁通过；唯一文档相关失败是源码公共导出 JSDoc（251 项），详见 `CODE_QUALITY_REVIEW.md:Q-002`。

## 3. 先行验证结果

| 命令或门禁 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm run build` | **通过**；Web 主 chunk 566.15/637.59/740.58 kB，Worker 705.78 kB | `/private/tmp/dsh-audit-20261001-build-final.log:2539,4368-4375` |
| `pnpm run typecheck` | **通过** | `/private/tmp/dsh-audit-20261001-typecheck-final2.log` |
| `pnpm run check:node-compat`、`publint`、built package invariants、doc typecheck | **通过** | 构建/卫生门禁日志 |
| `pnpm run hygiene` | **17 passed / 0 failed** | `/private/tmp/dsh-audit-20261001-hygiene-final3.log` |
| `pnpm run check:ci:static` | **56 passed / 1 failed**；唯一失败为 export JSDoc | `/private/tmp/dsh-audit-20261001-static-final3.log:375-377` |
| `pnpm lint` | **失败**；276 条 error，约 75 个文件 | `/private/tmp/dsh-audit-20261001-lint-final2.log` |
| `pnpm run duplication` | **失败**；18 组 clone、231 行重复，约 0.06% | `/private/tmp/dsh-audit-20261001-duplication.log` |
| `pnpm run test:coverage` | 1,433 files passed，24,711 tests passed；aggregate 97.59% statements / 95.77% branches / 97.70% functions / 98.08% lines，但因纳入文件的 100% per-file threshold 退出 1 | `/private/tmp/dsh-audit-20261001-coverage-final3.log:285-294,4653-4656` |
| `pnpm run test:e2e` | 4 files failed；16 failed、144 passed、104 skipped | `/private/tmp/dsh-audit-20261001-e2e-latest.log` |
| `pnpm run test:snapshot` | 4 files failed；129 failed、24 passed、2 skipped | `/private/tmp/dsh-audit-20261001-snapshot-latest.log:78652-78658` |
| `pnpm run test:expected` | 7 files failed；16 failed、75 passed | `/private/tmp/dsh-audit-20261001-expected-latest.log:3240-3245` |
| `pnpm run test:web:built` | 多个 settings/composer/navigation/live/lifecycle 等 suite 失败或 30 秒超时，并有 unhandled rejection/teardown error | `/private/tmp/dsh-audit-20261001-web-built-rerun.log:11909-11916`；消费者 gate 的最终运行亦失败 |
| `pnpm run test:bench:built` | 40 passed、1 failed；长会话等待 `Trajectory` 超时并在 teardown 抛 `AggregateError` | `/private/tmp/dsh-audit-20261001-bench-latest.log:8-71` |
| `pnpm run check:ci:consumers` | **失败**；built-bin smoke、expected、snapshot、web browser snapshot 等消费者门禁未全绿 | 本轮 2026-10-01 运行输出；门禁定义见 `scripts/run-gates.ts:801-828` |
| `pnpm run audit:prod` | **通过**；0 known vulnerabilities | `/private/tmp/dsh-audit-20261001-audit-prod-latest.log` |
| license/notices gates | **通过**；303 个 DSH 包为 MIT，notices freshness 通过 | `/private/tmp/dsh-audit-20261001-licenses-latest.log`、`...notices-latest.log` |

## 4. 风险计数

| 严重度 | 数量 | 当前含义 |
| --- | ---: | --- |
| P0 | 0 | 未确认阻断运行或已证实的全局重大安全问题 |
| P1 | 1 | `T-001` 发布消费者基线不成立；`A-001` 已关闭 |
| P2 | 6 | lint、公共导出文档、coverage、包体、浏览器 benchmark、发行物许可证闭包 |
| P3 | 5 | 重复代码、Context Router 性能量化、发行物预算、例外治理、开发依赖更新 |
| **合计** | **12** | 仅统计仍开放的问题；已验证关闭项不计入 |

完整登记见 `RISK_REGISTER.md`，每个专项报告重复记录路径、影响、证据和建议。

## 5. 最严重的 10 个问题

1. **T-001 [P1]**：expected、snapshot、Web built、built-bin 等发布消费者门禁同时失败，不能证明发行物行为一致。
2. **Q-001 [P2]**：276 条 lint error 横跨生产 webhook/media/schedule、Client 和测试边界。
3. **Q-002 [P2]**：export JSDoc gate 仍有 251 项公共导出说明缺失，API 文档契约不完整。
4. **T-002 [P2]**：coverage aggregate 虽高，但 per-file 100% 门槛失败，且大量 Client/Worker/inspector 路径被排除或未量化。
5. **P-001 [P2]**：Web 主 chunk、C++ grammar、vendor 和 Worker 均超过 500 kB 警戒线，冷启动预算未建立。
6. **P-002 [P2]**：240-turn 浏览器长会话 benchmark 找不到 `Trajectory` tab，真实 UI 性能指标缺失。
7. **D-001 [P2]**：生产依赖闭包仍有 Unknown、LGPL 和 MPL/复合许可证项，尚未按最终平台发行物核准。
8. **Q-003 [P3]**：18 组、231 行重复代码集中在平行 UI、webhook 和 media 适配层，存在修复分叉风险。
9. **P-003 [P3]**：Context Router 对大历史的多次扫描、token 估算和排序没有 p95/heap 基线。
10. **P-004 [P3]**：Electron/Python 发行物仍缺少包体、冷启动和 RSS 预算。

## 6. 建议修复顺序

1. **恢复 T-001 基线**：按 Session/fixture、assembled composition、built consumer、Web teardown 四类根因分组，直到 unexpected failure、unhandled rejection 和 teardown error 为零。
2. **扩展权限回归**：A-001 的 macOS 聚焦 assembled 路径已通过，仍需在 Linux/Windows backend、shell/PTC、symlink 和 child resume 上复验；禁止以刷新 golden 代替安全验证。
3. **恢复质量门禁**：处理 lint 和 251 项 JSDoc，再跑静态、typecheck、pack/consumer smoke。
4. **补测试和性能证据**：建立 coverage partition、长会话浏览器指标、Web/Worker 包体预算和发行物启动/RSS 预算。
5. **完成供应链核准**：按 npm、Python、Electron 平台生成 SBOM/notice，给 install-script、release-age 和 patch 例外补 owner/expiry/hash。

## 7. 健康度和发布判定

项目的分层和工程化基础仍可支撑继续开发：构建、类型、runtime closure、默认产品隔离、入口、license 和生产漏洞门禁均有正向证据。A-001 已在 assembled headless 路径上验证为物理拒绝，且新增了去重和 retry 回归；但 `T-001` 说明发行物消费者面仍不稳定，因此当前**不适合发布**，也不建议在未恢复门禁前继续扩大跨产品功能面。

## 8. 已验证关闭的旧问题

- SDK minimal 默认权限已从固定 `danger-full-access` 改为环境可选、默认 `workspace-write`：`packages/bundle/sdk-minimal/cordis.patch.yml:41-47`。
- Session v4 writer、catalog、fixture 和 built migration 路径已传播到当前版本：`packages/core/session/src/types.ts`、`packages/session/session-format-catalog/src/generated.ts`、`packages/session/session-persistence-jsonl/tests/built-migration-worker.e2e.ts:28-43`。
- `personal-agent` client export 和 build 产物已对齐；hygiene 17/0 通过。
- Client catalog 已重新生成；非 Git cwd 不再执行 `git status/diff`；process 级 exit listener 已共享 registry。
- Phone Access URL allowlist/lifecycle、Python PTC sandbox 接入、Context Router block/options 修复，以及 translation/README/Agent Note/repository reference 静态问题均已复核为关闭，不应继续按旧报告登记。
- A-001 assembled read-only child：`subagent-inheritance.expected.e2e.ts:116-170` 现在确认 `inherited.txt` 为 `ENOENT`，child 日志保留 `source: delegation` 的策略事件，聚焦测试的剩余失败仅为事件 fixture 漂移。
- Resume 工具结果去重：`packages/interaction/personal-agent/src/index.ts:726-738` 保留最新重复结果，`personal-agent.spec.ts:325-359` 回归通过。
- Provider retry：`retry-snapshot-backend.mjs:23-31` 排除 session-title 辅助调用后，assembled retry 场景已产生 `llm/retry` 和 `llm/retry-started`；当前 stream fixture 仍需随着已确认的新增生命周期事件重建。
