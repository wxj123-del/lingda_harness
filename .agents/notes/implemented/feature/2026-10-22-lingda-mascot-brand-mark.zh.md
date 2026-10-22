# Agent Note: 灵搭吉祥物取代鱼形品牌标识

Status: implemented

[English](2026-10-22-lingda-mascot-brand-mark.md) | 中文

## Problem

客户端各表面仍在沿用 DeepSeek 的品牌身份：侧栏与 New Session 主页绘制 `FISH_LOGO_PATH` 的鲸鱼轮廓，Web 与文档站 favicon 保存同一字形，桌面安装包没有产品图标，Electron 于是回退到默认图标。本部署以 Lingda Harness 发布（`apps/web`、`apps/desktop`），产品自己的界面却仍显示他方商标。

## Decision

`dsh-client-ui-primitives` 导出 `LingdaMascot`，把设定图的正面形象——头部、两侧叶耳与头顶浮玉——以 WebP data URL 渲染。素材自提供的吉祥物设定图裁切抠图，对浅色页面底色做过反混合，并略微提升清晰度，使其在 24px 侧栏尺寸下眼睛仍可辨认。它取代 `FishLogo`、`BrandWordmark`、`FISH_LOGO_PATH` 与 `FISH_LOGO_VIEWBOX`，后四者删除：产品标识变为全彩插画之后，已没有界面需要单色的 `currentColor` 标识。

标识沿用既有 slot 进入界面。`ui-sidebar` 保留 `sidebar.brand.mark`，回退为 `LingdaMascot`；`ui-conversation` 保留 `conversation.hero.brand.mark`，同样以该组件渲染 34px 版本，部署仍可替换任一座位。首屏的 SMIL 路径变形与跟随文字墨色的摇摆随 svg 一并移除；命中框改为 CSS 浮动——以下巴为支点的上浮与偏转——仍受 `(hover: hover) and (prefers-reduced-motion: no-preference)` 约束，因为位图无法变形自身曲线。

`apps/web/public/favicon.svg` 与 `website/public/favicon.svg` 把同一素材包成 64px 的 `<image>`，让 favicon 在浅色与深色配色下保持同一套调色板，而不再反转黑色路径。文档站导航栏的品牌组合去掉内联的 DeepSeek 字标，改为吉祥物加本地化产品名，`website/public/wordmark.svg` 随之一并删除。`apps/desktop/build/` 提供 electron-builder 使用的 `icon.icns`、`icon.ico` 与 `icon.png`，manifest 的安装身份改为 Lingda Harness / 灵搭，并在 SVG favicon 之外补上 192px 与 512px 位图安装图标。

## Alternatives considered

**把吉祥物重绘为手写 SVG。** 标识必须能在 24px 的侧栏里辨认；矢量化追踪与手绘版本在该尺寸下都糊成一团，而设定图渲染时的渐变质感下采样后反而更清晰。data URL 也不需要资源管线，而 Client 插件包本来就没有：若改用 `.webp` 导入，得照 PDF.js 素材的做法写包内构建插件来内联。

**保留鱼形作为单色回退，只在首屏加入吉祥物。** 这样用户最常看的侧栏仍挂着 DeepSeek 标识，产品里同时存在两套品牌语汇。

**把吉祥物做成独立品牌包占据这些 slot。** `ui-brand-official` 已刻意退役、不注册任何占位者；为一张静态标识新增占位包会多出一条组合轴，且 `ui-conversation` 首屏回退仍需同一份素材，因为特性插件不得跨包 value-import。

## Consequences

标识自带调色板、不再跟随 `currentColor`，主题变化不会给它染色；该限制记录在 primitives README 的已知限制中。内嵌约 17KB 的 base64 进入 primitives 包，每个 import 该 barrel 的客户端插件都要承担，即使它不渲染标识。素材源自已发布的设定图，重新裁切需要原插画；裁切边界与色调提亮没有以脚本形式入库。

## Verification

- `packages/client/ui-primitives/tests/icons.client.spec.tsx` 固定 data URL 前缀、正方形尺寸与装饰性属性。
- `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` 断言首屏回退经 slot 渲染 34px 吉祥物。
- `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` 断言侧栏回退渲染 24px 吉祥物。
- `apps/web/tests/pwa-manifest.e2e.ts` 固定灵搭的 manifest 身份、位图 favicon 与两张安装图标。
- `apps/desktop/tests/macos-signature.spec.ts` 固定各打包平台的图标路径及其存在性。
- `apps/web/tests/startup-auto-selection.e2e.ts` 断言首屏标识悬停时播动画。

`packages/test-support/client-runtime` 的快照序列化器把内联 `<img>` 的载荷折叠成指纹，并把 `src` 留在 data URL 前缀，既让侧栏 DOM 快照可读，又能在素材变化时翻新指纹。
