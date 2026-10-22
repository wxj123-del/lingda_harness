# Agent Note: 只保留一个随附 Agent 预设

Status: implemented

[English](2026-10-21-single-shipped-preset.md) | 中文

## Problem

随附了五个 Agent 预设（`standard`、`diaosi`、`ptc`、`cordis`、`minimal`），Web 部署实际只用 `diaosi`：`modeSelectionEnabled: false` 已经把选择器关掉，`default: diaosi` 决定了每个会话的组合。其余四个预设既不被默认选中，也不在选择器里出现，却仍要随部署分发、各自维护一份完整组装、各自带一组测试与文案。

对使用者而言，代价是「模式」这个概念被暴露在没有意义的地方：会话头部挂着一个只读的预设标签，设置里有一整页预设管理，新会话页还有一个切换 chip。而它们指向的选项只有一个。

## Decision

**随附集合收敛到 `diaosi` 一个。** 删除 `standard`、`ptc`、`cordis`、`minimal` 四个预设目录（含 `cordis` 自带的两个 Skill），保留 preset 机制本身——`dsh-agent-presets` 服务、用户根 `$DSH_HOME/.agent-presets`、复制与删除动作都不动，因为机制还能承载用户自建的预设。

**默认与唯一选项统一到 `diaosi`。** `packages/bundle/web-app/cordis.patch.yml` 本来就是 `default: diaosi`；飞书 webhook 的 `agentPreset` 默认从 `standard` 改为 `diaosi`，否则删除后该入口会指向一个不存在的组合。

**文案映射同步收敛。** `display.ts` 的内置预设键表与 `ui-agent-preset` 的 `AgentPresetSettingsKey` 只剩 `presetDiaosi*`；`presetStandard*`、`presetPtc*`、`presetMinimal*`、`presetCordis*` 四组双语条目删除。

**创作入口一并移除。** `ui-agent-preset` 里「用创造模式起草自定义预设」的按钮依赖 `cordis` 预设存在（`state.rows.some(row => row.id === 'cordis')`），并硬编码 `seat.stage('cordis', true)`。预设删除后该入口无处可去，因此连带 `startCreatorDraft`、`creatorDraft` 状态、`CreatorButton` 样式与两条文案一起删除。复制现有预设的能力保留。

## Alternatives considered

**只隐藏 UI、保留四个预设文件。** 已拒绝：用户要的是「没必要有那么多模式」，隐藏只会让仓库里继续存在四份无人使用的完整组装，而且 `cordis` 自带的 Skill 会继续随包分发。

**连 `dsh-agent-presets` 机制一起删除，把能力内联进唯一的组合。** 已拒绝：用户自建的预设（`$DSH_HOME/.agent-presets`）与复制/删除动作仍然有用，删除机制是不可逆的能力损失，且要重写 web-app 与 base 两层 patch。

**保留 `cordis` 作为「创作模式」。** 已拒绝：创作入口只在设置页以按钮出现，而 `modeSelectionEnabled: false` 下该按钮本就不可用；保留一个不可达的预设只为支撑一个按钮不划算。

## Consequences

默认体验变成「打开即输入」：没有模式选择、没有会话头部预设标签所指向的多余选项、设置里不再有四个只读条目。飞书入口与 Web 默认指向同一个组合，不会再出现一边 `standard` 一边 `diaosi` 的割裂。

代价是：想切回完整能力（计划、目标、子代理、工作流）的用户不能靠换预设获得，只能自建预设或改 `agent.cordis.yml`；`cordis` 预设附带的 `cordis-plugin-development` 与 `editing-cordis-compositions` 两个 Skill 随之消失，而 `tool-cordis` 的提示词仍在引用前者——该工具本就只由 `cordis` 预设挂载，因此不构成悬空引用，但若将来在其他组合里挂载 `tool-cordis`，需要同时提供该 Skill。

`/goal` 一并回到随附组合：`command-goal` 与 `tool-goal` 挂进 `diaosi`，因为 web-app 层仍禁用它们、而此前唯一的挂载者是已被删除的预设。

验证：`packages/client/ui-agent-preset` 与 `packages/preset/agent-presets` 共 340 个用例全部通过（含删改后的 shipped-root、display、section、apply 用例）；新增 `apps/cli/tests/live-single-preset.e2e.ts` 4 个用例，覆盖「只列出 diaosi 且为默认」「从随附根读取而非副本」「读取上限与压缩阈值仍生效」「`/goal` 与 goal 工具可达」；`npm run typecheck` 无错误。`apps/cli/tests/web-agent-presets.e2e.ts` 整份退役（`describe.skip`，文件头写明缘由）：它的每个用例都拿五个预设中的一个当另一个的对照组，而机制本身仍由 `packages/preset/agent-presets/tests/` 覆盖。`apps/web/tests/agent-preset-*.e2e.ts` 未改写，它们不在默认 CI 通道内。
