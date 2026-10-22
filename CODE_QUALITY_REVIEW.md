# 代码质量与潜在缺陷审计

## 1. 总体判断

`pnpm run typecheck`、`pnpm run build` 和 `pnpm run hygiene` 通过，说明 project references、主要构建入口和包卫生基础可用。质量门禁仍未收敛：lint 有 276 条错误，公共导出 JSDoc gate 有 251 项，重复代码 gate 有 18 组 clone。这些问题跨生产代码、Client、webhook、media、schedule 和测试辅助，不是单纯的格式噪声。

## 2. 开放问题

### Q-001 [P2] lint error 横跨生产边界和测试边界

- **文件路径和行号**：代表性生产位置为 `packages/media/image-generation/src/tool.ts:30,85`、`packages/schedule/schedule/src/domain.ts:413`、`packages/schedule/schedule/src/service.ts:120,201`、`packages/webhook/webhook-feishu/src/index.ts:127,318-328`、`packages/interaction/git-workspace/src/index.ts:238,533-580`；代表性测试位置为 `packages/client/ui-layout/tests/workflow-compile.client.spec.ts:53-190` 和 `packages/media/image-generation/tests/runtime.spec.ts:47-107`。
- **问题描述**：Oxlint/tsgolint 报告 276 条 error，包含 `no-unsafe-*`、`no-unnecessary-condition`、`no-confusing-void-expression`、`no-implied-eval`、`no-deprecated`、`use-unknown-in-catch-callback-variable`、`no-non-null-assertion` 等。编译器通过并不能证明运行时输入、错误对象和 mock 已经按公开类型安全收窄。
- **影响范围**：webhook 解析、schedule/Remote 错误、media adapter、Client workflow 编译和测试 mock；错误边界可能丢失类型信息，未来升级依赖时更容易出现行为漂移。当前没有证据表明每一条 lint 都是可利用漏洞，因此定为 P2。
- **复现或验证依据**：`pnpm lint` 非零退出；`/private/tmp/dsh-audit-20261001-lint-final2.log` 中可数得 276 条 `: error `，且生产文件错误仍出现在日志末尾。
- **修复建议**：按生产代码、跨包 mock、测试辅助的顺序清理；把外部/Remote 值收窄为 `unknown` 后显式解析，移除隐式 `Function`/非空断言，迁移 deprecated Session API；禁止全局 disable 或只提高阈值，修复后保留负向测试。

### Q-002 [P2] 公共导出 JSDoc 不完整，API 文档门禁未通过

- **文件路径和行号**：代表性位置为 `packages/client/ui-layout/src/authoring-settings.ts:3-9,106-134`、`packages/context/context-router/src/router.ts:145,193,216,748`、`packages/host/knowledge/src/types.ts:4-90`、`packages/media/image-generation/src/types.ts:5-21`、`packages/webhook/webhook-feishu/src/feishu.ts:12-103`。
- **问题描述**：`verify-export-jsdoc` 发现 251 项公共导出缺少模块说明、类型说明、参数或返回值文档。其余文档静态门禁已在 final3 运行中通过，但这些 source-level API 仍不能作为完整的使用契约。
- **影响范围**：SDK 和插件消费者、Typert/工具目录生成、代码审查和双语文档维护；缺失的参数/返回值语义尤其影响跨 package 使用者判断错误处理和生命周期。
- **复现或验证依据**：`pnpm run check:ci:static` 返回 `56 passed, 1 failed`，唯一失败为 `verify-export-jsdoc`；`/private/tmp/dsh-audit-20261001-static-final3.log` 报告 `251 JSDoc completeness violation(s)`。
- **修复建议**：先补 public source export 的简短行为说明和全部 `@param`/`@returns`，再运行生成器和 `doc-typecheck`；将 JSDoc gate 纳入每个新 package 的验收，不要以关闭 gate 或批量生成空注释代替契约。

### Q-003 [P3] 重复代码集中在平行 UI 和适配层

- **文件路径和行号**：代表性 clone 为 `packages/client/ui-layout/src/client/authoring/SkillEditor.tsx:14-37` 与 `ToolEditor.tsx:13-33`、`packages/client/ui-step-insight/src/client/GitWorkspaceView.tsx:27-33` 与 `RepositoryFlow.tsx:237-244`、`packages/webhook/webhook-feishu/src/handler.ts:29-37` 与 `packages/webhook/webhook-github/src/handler.ts:32-41`、`packages/media/image-generation/src/tool.ts:11-50` 与 `packages/media/speech-generation/src/tool.ts:11-32`。
- **问题描述**：jscpd 找到 18 组 clone、231 行重复（TSX 57 行，TypeScript 174 行，总重复率约 0.06%）。比例不高，但重复位于相同职责的 UI、webhook 和 media 适配层，契约演进时容易只修一侧。
- **影响范围**：维护成本、行为分叉、重复测试和未来安全修复传播速度；不会单独阻断运行。
- **复现或验证依据**：`pnpm run duplication` 失败；`/private/tmp/dsh-audit-20261001-duplication.log` 汇总为 18 clones、231 duplicated lines。
- **修复建议**：只对语义完全相同的序列提取小型共享 helper 或 primitive；保留领域差异，避免为通过 gate 进行大范围抽象；抽取后为公共 helper 增加一组行为测试。

## 3. 已通过和已关闭的质量信号

- `pnpm run typecheck` 在 strict/noImplicitAny 约束下通过，Host/Client project references 可生成。
- `pnpm run hygiene` 17/0，通过 publint、package dependencies、source artifacts、client packages、i18n、catalog、runtime closure 等门禁。
- `pnpm run check:ci:static` 的 translation pairing、README model experience、Agent Note format、repository references、client catalog 等旧失败已关闭；当前只剩 export JSDoc。
- `packages/interaction/git-workspace/src/index.ts:675-691` 已在非 Git cwd 提前返回，不再执行三组 Git 命令；`packages/subprocess/subprocess-local/src/index.ts:51-86` 已使用共享 process exit registry。
- 本轮没有为消除这些问题修改任何源码或配置；报告只记录观察结果。

## 4. 质量验收顺序

1. 先清理生产文件中的 lint error 和潜在 unsafe 值。
2. 补齐 251 项 export JSDoc，重新运行静态/doc gates。
3. 对平行模块做最小 helper 抽取并保留领域测试。
4. 在干净工作树上复跑 typecheck、build、consumer 和 snapshot，避免把用户未提交变更误判为质量回归。
