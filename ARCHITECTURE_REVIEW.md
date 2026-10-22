# 架构设计与模块依赖审计

## 1. 架构摘要

项目是以 Cordis Context/Plugin 为运行时内核的 TypeScript monorepo。核心层提供 Agent、Session、Scope、Tools 和 typed events；能力层以 Service Definition/Provider/Consumer 组成 capability seam；Typert 生成 Host、Client、Remote 投影；`packages/bundle` 和 `apps/*` 负责把能力装配成 CLI、Headless、SDK、Web、Electron 产品。Session 事件日志是持久化真源，format catalog 和相邻 migration 负责历史读取。Python runtime、native addon 和 vendored Cordis 是独立的发行面。

总体分层清晰，且源代码面与构建产物面有明确区分。`runtime closure`、`application entrypoints`、`default product isolation`、`node-next types`、`built package invariants` 和 `module graph` 门禁均通过。当前最重要的架构问题不是缺少抽象，而是**权限投影在真实 assembled child 路径没有闭合**，导致持久日志中的策略和实际文件效果不一致。

## 2. 模块覆盖与依赖方向

本轮逐组检查了 53 个 `packages/*` 一级目录的 manifest、入口、依赖或对应 gate：

`acp`、`api`、`attachment`、`boot`、`browser-use`、`bundle`、`client`、`compaction`、`computer-use`、`context`、`core`、`credentials`、`experimental`、`extensions`、`feedback`、`fs`、`goal`、`guard`、`hooks`、`host`、`identity`、`interaction`、`jobs`、`llm`、`lsp`、`mcp`、`media`、`plan`、`preset`、`ptc-runtime`、`runtime-diagnostics`、`sandbox`、`schedule`、`sdk`、`session`、`session-query`、`settings`、`shell`、`skill`、`spill`、`ssh`、`storage`、`subagent`、`subprocess`、`terminal`、`test-support`、`todo`、`typert`、`util`、`web`、`webhook`、`workflow`、`workspace`。

| 层 | 主要职责 | 依赖约束 | 审计判断 |
| --- | --- | --- | --- |
| `vendor/` | Cordis、schemastery 等上游源码 | 被上层包消费，不反向依赖产品 | 通过 vendor rescope gate |
| `packages/core` | Agent、Session、Scope、Tools、事件 | 只依赖基础 util/协议 | 类型和模块图通过 |
| 能力包 | fs、shell、sandbox、LLM、workflow、webhook 等 | 通过 Context service 和 typed event 接入 | seam 角色齐全，测试面不均衡 |
| 投影/适配 | `api/remotes`、Typert、client catalog、SDK | Host/Client face 分离 | 生成物 gate 通过；消费者 gate 未全绿 |
| bundle/profile | `packages/bundle/*` | 只做配置装配，不绕过 service owner | SDK minimal 权限已改为显式环境 opt-in |
| 产品 | `apps/cli`、`apps/web`、`apps/desktop` | 只经 profile/应用入口启动 | 入口 gate 通过，Web consumer 仍失败 |
| 外部发行面 | Python、native、Electron、vendor | 独立构建、打包、许可证闭包 | 尚缺平台发行物级验证 |

## 3. 架构发现

### A-001 [P1] assembled 子 Agent 没有实际继承 read-only 文件策略

- **文件路径和行号**：测试断言在 `apps/cli/tests/profiles/headless/tests/subagent-inheritance.expected.e2e.ts:95-120`；策略快照在 `packages/subagent/subagent-in-process-driver/src/index.ts:117-143`、`packages/subagent/subagent/src/child-agent.ts:246-275`；策略解析在 `packages/sandbox/sandbox-policy/src/index.ts:164-180`；写入围栏在 `packages/fs/fs-sandbox/src/index.ts:122-143`；assembled overlay 在 `apps/cli/tests/profiles/headless/subagent-inheritance-snapshot.patch.yml:12-35`。
- **问题描述**：测试先在父 Session 日志写入 `sandbox/mode: read-only`，再通过 shipped headless composition 委派 child。实现确实尝试在第一次 `await` 前捕获并追加 delegation policy，但真实 assembled 路径中 child 的文件写入成功，说明 child 的工具执行没有使用日志中记录的 read-only 策略，或使用了错误的 FS/provider/context 实例。持久事件和物理效果不一致，破坏了“model-visible 约束可由日志重建”的架构不变量。
- **影响范围**：所有使用进程内 subagent、父 Session 权限覆盖和本地文件工具的 CLI/SDK/Web 组合；read-only 任务可能修改会话 workspace，后续审计、恢复和用户判断也会被错误的拒绝事件预期误导。
- **复现或验证依据**：单独运行 `pnpm exec vitest run --config vitest.expected.config.ts apps/cli/tests/profiles/headless/tests/subagent-inheritance.expected.e2e.ts` 稳定失败，结果为 `promise resolved "escaped" instead of rejecting`；测试实际在 `:119` 读取到了 `inherited.txt`，而预期是 `ENOENT`。这不是 golden 文本差异，而是磁盘上的物理写入。
- **修复建议**：沿 child creation、Context injection、session projection、tool execution 逐层记录 provider identity 和 resolved policy；让 child 的每个 mutation 在执行前从自身 Session 解析并强制传入 policy，缺少 sandbox provider 时 fail-closed；补 assembled headless、Web、SDK、续接 child、不同平台 backend 的越界写负向测试，并把该测试设为发布 gate。

## 4. 架构正向信号

- `tsconfig.host.json` 与 `tsconfig.client.json` 保持 Host/Client face 分离，`pnpm run typecheck` 和 `pnpm run build` 通过。
- Session v4 已有相邻 migration package、生成 catalog 和 built worker 路径；当前 `built-migration-worker.e2e.ts:28-43` 使用 `SESSION_FORMAT_VERSION`，旧的 v3 硬编码已关闭。
- capability seam 的 service/provider/consumer 角色在 fs、sandbox、subagent、workflow、webhook 等模块中可定位；静态 module graph gate 通过。
- 生成型边界有 freshness gate：client catalog、tool/config/catalog、第三方 notices 均有检查；本轮只剩 export JSDoc gate 未通过。
- profile 装配遵守 `dsh` 入口约束；hygiene、runtime closure、default product isolation 和 application entrypoint gates 全部通过。

## 5. 架构发布条件

1. 先关闭 A-001，并证明 policy projection、provider injection 和 mutation fence 在每个 shipped composition 中使用同一 resolved policy。
2. 重新运行 `check:ci:consumers`，确保 built package、snapshot、expected、Web browser 和 plain-Node consumer 不再依赖 workspace source 偶然行为。
3. 对 Session v0-v4、child seed/resume、权限覆盖和 provider 缺失建立同一套事件与物理效果断言。
4. 为 Electron/Python/native 发行面补独立 artifact manifest、SBOM、启动和跨平台 smoke；这些边界不能由 TypeScript build 代替。
