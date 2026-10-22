# 安全风险审计

## 1. 结论

本轮确认一个 P1 安全问题：assembled headless 的进程内子 Agent 没有执行父 Session 的 `read-only` 文件策略，测试观察到真实文件写入成功。该问题必须在发布前关闭。除此之外，`pnpm run audit:prod` 返回 0 known vulnerabilities，入口隔离、生产 runtime closure、Phone Access URL allowlist 和 Python PTC 的 sandbox 接入均有正向证据。本轮没有确认 P0。

## 2. 威胁面检查

| 面 | 检查点 | 结果 |
| --- | --- | --- |
| 模型执行 | shell、PTC、subprocess、fs、sandbox、subagent | child policy inheritance 有 P1 回归；直接 sandbox fence 的单元路径存在 |
| 文件系统 | `read-only`、`workspace-write`、`danger-full-access`、symlink re-check | `fs-sandbox` 的 fence 有实现，但 assembled child 没有实际使用期望 policy |
| 网络入口 | Phone Access、Webhook、Remote | Phone Access bare HTTPS ngrok allowlist 已通过复核；未发现新的任意 origin 证据 |
| 凭据与日志 | credential service、SDK env、Session/telemetry | 本机未运行真实 provider key/平台发行物 smoke；不能把缺少 key 当作漏洞，但发布前须验证脱敏和授权日志 |
| 供应链 | lockfile、install scripts、license、npm audit | production audit 0 advisory；发行物许可证闭包仍见 `DEPENDENCY_REVIEW.md` |
| 应用入口 | dsh profile/application entrypoint | 静态 runtime closure、default product isolation、application entrypoints 通过 |

## 3. 开放问题

### A-001 [P1] 委派 child 绕过父级 read-only 文件策略

- **文件路径和行号**：复现测试 `apps/cli/tests/profiles/headless/tests/subagent-inheritance.expected.e2e.ts:95-120`；策略捕获/传播 `packages/subagent/subagent-in-process-driver/src/index.ts:117-143`、`packages/subagent/subagent/src/child-agent.ts:246-275`；解析器 `packages/sandbox/sandbox-policy/src/index.ts:164-180`；文件 fence `packages/fs/fs-sandbox/src/index.ts:122-143`；测试组合 `apps/cli/tests/profiles/headless/subagent-inheritance-snapshot.patch.yml:12-35`。
- **问题描述**：父 Session 日志包含 `sandbox/mode: read-only`，部署默认仍是 `workspace-write`，child 应继承父级显式覆盖。但 assembled headless 运行时实际创建了 `inherited.txt`，说明 delegation event 没有到达执行 child mutation 的 policy resolver，或 child 使用了不受该 resolver 约束的 provider/context。该结果构成权限降级/策略绕过：日志宣称只读，物理文件效果却可写。
- **影响范围**：CLI headless、SDK 或 Web 中使用 in-process subagent 的 read-only 任务；模型可通过 delegated write 修改 workspace 中的源码、配置或生成物。若调用者把 workspace 指向敏感目录，影响范围随调用者文件权限扩大。
- **复现或验证依据**：稳定运行 `pnpm exec vitest run --config vitest.expected.config.ts apps/cli/tests/profiles/headless/tests/subagent-inheritance.expected.e2e.ts`。Vitest 在 `:119` 报 `promise resolved "escaped" instead of rejecting`，即 `readFile(join(runCwd, 'inherited.txt'))` 成功；预期是 `ENOENT`。这是磁盘物理事实，不是 snapshot 差异。
- **修复建议**：让每个 child mutation 在执行前以 child Session 解析 policy，并将该 policy 强制传入 FS/shell/PTC provider；禁止通过默认 provider 回退覆盖显式 delegation override；provider 缺失、projection 未就绪或 policy source 不明时 fail-closed。补 assembled headless/Web/SDK、continuation/resume、跨平台 sandbox backend、symlink 和 direct shell 的负向写入回归，并将其设为 `check:ci:consumers` 阻断项。

## 4. 正向控制和已关闭问题

### 4.1 SDK minimal 默认权限（已关闭）

`packages/bundle/sdk-minimal/cordis.patch.yml:41-47` 现在默认 `DSH_PERMISSION_MODE ?? 'workspace-write'`，`danger-full-access` 只通过显式环境变量 opt-in；`README.md:12,35` 同步了限制。仍应在发行物 smoke 中验证环境变量和 sandbox backend 的 fail-closed 行为，但旧的“固定高权限默认”不再是开放发现。

### 4.2 Phone Access URL 与生命周期（已关闭）

`packages/webhook/phone-access/src/index.ts:42-66` 只接受 bare HTTPS ngrok authority，拒绝 path、凭据、port、query、fragment 和其他 host。`packages/client/ui-settings-plugins/src/client/phone-access-card-controller.ts:133-170` 使用可选 Remote 探测和 `finally` 复位，旧的任意 URL 注入和永久 busy 结论不再成立。

### 4.3 Python PTC 文件 confinement（已接入）

`packages/experimental/ptc-runtime-python/src/index.ts:1059-1117` 在非 `danger-full-access` 时解析 `sandboxPolicy` 并调用 backend `confine()`；CPython 3.10 聚焦测试为 250 passed、2 skipped。Linux/Windows/native backend 的完整发行物矩阵仍是发布验证缺口，不将其误报为当前已证实漏洞。

## 5. 安全发布门槛

1. A-001 的复现必须在真实 assembled child 路径上变为 `ENOENT`/结构化 sandbox denial，并保留父子 Session policy 事件。
2. 在 macOS、Linux、Windows 目标 backend 执行 read-only、workspace-write、symlink、shell、PTC 和 child resume 回归。
3. 对 npm、Python runtime 和 Electron 产物执行 credentials/telemetry 脱敏、权限降级和 bundled native payload smoke。
4. 将 unhandled rejection、policy provider 缺失和 sandbox fallback 设为硬失败，不仅记录 warning。
