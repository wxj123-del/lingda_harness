# 第三方依赖与许可证审计

## 1. 依赖清单和正向控制

| 层 | 审计事实 |
| --- | --- |
| JavaScript workspace | 321 个 workspace 条目（含根），303 个 `@deepseek-ai/dsh-*` 包；workspace 定义在 `pnpm-workspace.yaml:1-15` |
| JavaScript lock | `pnpm-lock.yaml` lockfile v9，registry 包有 integrity；`pnpm-workspace.yaml:20-33` 设有生产依赖安全版本 floor |
| Python | `python/sdk/pyproject.toml:5-16` 声明 Python `>=3.10`；`python/sdk/uv.lock` 固定 Python closure 和 hash |
| Native/vendor | `native/system` 提供平台包；`vendor/` 保存 Cordis 源码、上游版本和本地修改记录 |
| 第一方许可证 | `verify-dsh-package-licenses` 检查 303 个 DSH 包，均 MIT；native first-party package 另有 BSD 3-Clause 声明 |
| Notices | `verify-third-party-notices` freshness gate 通过；`THIRD_PARTY_NOTICES.md` 说明 direct/runtime/dev 分层 |
| 生产漏洞 | `pnpm run audit:prod` 通过，0 known vulnerabilities |
| 生产闭包 | 结构化 license 扫描得到 535 条去重闭包：MIT 383、Apache-2.0 76、BSD-3-Clause 26、ISC 22，另含 Unknown/LGPL/MPL 等少数项 |

## 2. 开放问题

### D-001 [P2] 非 MIT 许可证和 Unknown 项尚未按最终发行物核准

- **文件路径和行号**：直接 notices 的运行时/平台说明在 `THIRD_PARTY_NOTICES.md:28-36,128-149`；开发工具许可证在 `THIRD_PARTY_NOTICES.md:152-230`；Electron 产物选择在 `apps/desktop/electron-builder.config.mjs:61-78`；Python runtime 根在 `python/sdk-runtime/package.json:7-136`。
- **问题描述**：生产 closure 扫描显示 3 个 `Unknown`（`@anthropic-ai/claude-agent-sdk`、当前平台 Claude payload、`flatbuffers`）、1 个 `LGPL-3.0-or-later`（`@img/sharp-libvips-darwin-arm64`）、5 个 `MPL-2.0`、1 个 `MIT AND MPL-2.0`，以及其他 BlueOak/Python/Unlicense/CC0 项。NOTICE 文件对部分开发工具作了 dev-only 说明，但没有按 npm tarball、Python runtime、Electron macOS/Windows 产物拆分证明实际分发闭包。
- **影响范围**：Bundled native binary、动态链接组件、源码/notice 提供义务、官方 Claude payload 条款确认和平台差异；`pnpm audit` 只查漏洞，不代表许可证合规。
- **复现或验证依据**：`/private/tmp/dsh-audit-20261001-prod-licenses.json` 的键集合和计数为 Unknown 3、LGPL 1、MPL 5、复合 1，总条目 535；`THIRD_PARTY_NOTICES.md:134-149` 仍把 Claude payload 标为 `SEE LICENSE IN LICENSE.md`，未提供发行物级核准记录。
- **修复建议**：对 npm pack、Python runtime 和 Electron macOS/Windows 分别生成 SPDX/CycloneDX SBOM、bundled-file 清单和 LICENSE/NOTICE 汇编；补齐 Unknown 来源和官方 payload 条款确认，明确 LGPL/MPL 是 dev-only 还是随产物分发，并在 CI 对 closure/license 变化做 diff 审核。

### D-002 [P3] install-script、release-age 和本地 patch 例外缺少机器可审计的生命周期

- **文件路径和行号**：`pnpm-workspace.yaml:39-108` 的 `allowBuilds`、`minimumReleaseAgeExclude`、`patchedDependencies`；patch 文件为 `patches/@electron__osx-sign@1.3.3.patch:1`、`patches/@yao-pkg__pkg@6.21.0.patch:1`、`patches/node-pty@1.2.0-beta.15.patch:1`。
- **问题描述**：pnpm 默认拒绝未审查 lifecycle script 是正向控制，但例外条目没有统一 owner、理由、批准时间、到期时间、上游 commit/hash 或退役条件。升级后可能继续携带已经无必要的例外，或在上游行为改变时静默套用旧 patch。
- **影响范围**：native binary、install-time code、供应链审查、可重复安装和 patch 安全边界；当前没有已利用证据，但审计可追踪性不足。
- **复现或验证依据**：上述 YAML 直接列出允许 build 的包、20 余个 release-age 排除项和 3 个 patched dependency；现有 hygiene gate 验证文本/锁文件一致性，但不验证 owner/expiry 或 patch semantic diff。
- **修复建议**：为每项例外增加 owner、理由、批准日期、到期日期和上游 hash；升级时自动执行 install-script diff、patch dry-run、native hash/signature 检查和 SBOM diff；过期例外让 CI 失败。

### D-003 [P3] 根开发依赖有 24 项落后 latest

- **文件路径和行号**：根开发依赖声明在 `package.json:201-248`；版本策略和安全 floor 在 `pnpm-workspace.yaml:20-37`。
- **问题描述**：`pnpm outdated --format json` 返回 24 项 current < latest，涉及 Vitest、TypeScript、jsdom、oxlint、tsdown、mermaid、jscpd、Python/Node tooling 等。版本落后本身不是生产漏洞，但会推迟 bugfix、安全修复和工具链兼容性改进。
- **影响范围**：测试 runner、类型系统、bundler、文档生成和构建 reproducibility；集中升级时可能与现有 snapshot、patch 和 generated catalog 同时冲突。
- **复现或验证依据**：`/private/tmp/dsh-audit-20261001-outdated-latest.json` 有 24 条，代表性为 `vitest 4.1.11 -> 5.0.2`、`typescript 6.0.3 -> 7.0.2`、`jsdom 29.1.1 -> 30.1.1`、`oxlint 1.76.0 -> 1.86.0`；`pnpm outdated` 退出状态为 1。
- **修复建议**：按测试/编译/文档栈分批升级，先处理 patch/minor 和安全修复，再为 Vitest、TypeScript、jsdom、mermaid major 建独立兼容分支；每批升级后重跑 lint、snapshot、publint、generated catalogs 和 built consumer。

## 3. 依赖治理结论

- 当前 lockfile、uv.lock、pnpm security floor、allowBuilds deny-by-default、第一方 license gate 和 notices freshness 构成了可审计基础。
- `audit:prod` 为 0 advisory 不等于 native payload、Python closure 或最终 Electron tarball 已完成合规审查。
- 发行物级 SBOM 和 license diff 应先于任何公开发布，而不是在发布后补 notices。
