---
description: "Web GUI 的外壳布局：三栏 AppFrame（右栏作为贴边面板的轨道）、面板几何服务与主题呈现；供窗口外壳的使用者与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

## 概述

本包提供 Web GUI 的三栏 AppFrame、左右栏宽度与 `ctx.layout` 呈现控制，也提供 Skill、工作流、工具和知识库的编辑界面。[知识库 Host](../../host/knowledge/README.zh.md) 独立于 UI 设置保存文档和向量。右栏先让步以保护中栏空间，全屏由占用方呈现，框架保留宽屏底层轨道。主题呈现器负责配色、别名 token、正文字号与 document 元数据；布局状态在刷新后重置。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

本插件在 root slot 中组合侧边栏、主内容和右栏。侧边栏宽度为 264～420px，默认为 280px，收起后保留 56px 控制栏；窗口宽度低于 1024px 时自动收起，打开右侧面板也会收起手动展开的侧边栏。右侧面板首次打开时使用视口宽度的 45%，之后保留用户的像素宽度偏好，上限为 70%。为给中栏保留 400px，框架先将右侧面板缩减至 300px，再报告空间不足，使占用方将其关闭，最后才进一步压缩中栏。拖动没有过渡延迟；右侧手柄在关闭或全屏时不显示。

全局面板占据 root 作用域的 `main` keyed slot；`conversation` 是为会话界面保留的 key。`ctx.layout.selectPanel(id)` 选中已注册面板，`null` 则选中会话界面，但不改变当前会话。编辑页面注册各自的全局面板 key。

### 主题呈现

呈现器消费解析后的主题快照，并投影到 document：`html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，把主题的别名 token 与 `--dsh-content-font-size` 设为 body 上的内联变量，并持有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新。对呈现器执行 dispose（资源释放）时，它会连同其他全局写入一起移除自己的元数据节点。

### 工具目录

指标栏显示保留会话中的已结束请求、工具携带次数、命中次数和聚合命中率，不受搜索及筛选影响。卡片显示各工具的携带次数和命中率，详情增加命中次数。按携带次数降序或命中率升序排序，可定位经常携带但很少调用的工具。破折号表示没有可测量的携带记录，缺失目录则单独显示覆盖提示。这些指标只读，不改变工具选择。

选择导航栏的**工具**，即可按卡片浏览已记录或用户创建的工具。卡片展示名称、说明、累计调用次数与最近调用时间。筛选可区分已调用、未调用和自建工具；搜索覆盖名称与说明，支持按次数或工具名排序。详情展示完整说明、已记录的参数定义、直接与内部调用次数及涉及会话。自建工具保留创建和编辑能力，保存说明与步骤；统计按注册名称关联，不依赖展示标题。

已收录工具的卡片和详情使用界面语言对应的说明，可展开查看记录中的原始说明。搜索同时匹配本地化说明与原文。自建及未收录工具保留其原有说明。界面翻译不调用模型，也不修改提供给模型的工具定义。

刷新通过 `pluginInventory/toolUsage` 读取统计，不发起模型请求。读取失败时显示错误状态，无法读取的会话会触发统计不完整提示，卸载会取消尚未完成的读取。[宿主读取器](../../host/plugin-inventory/README.zh.md#tool-usage)维护跨会话计数规则。插件页面不再包含工具使用统计标签页。

### 用户创建的插件

编辑导航把 Skill、工作流和工具保存到 `ui-authoring` 设置命名空间。知识库编辑器调用 `knowledge` Remote，并一次性导入旧设置。每个知识库独立保存文档、启用状态以及递归、Markdown 或固定长度切分设置。编辑器支持手动录入和本地 UTF-8 文件（`txt`、Markdown、JSON、CSV 和 YAML），提供片段预览、索引错误与重试，以及针对已保存索引的检索测试。存在未保存修改时不能进行检索测试。

技能广场统一展示内置的“创建 Skill”（`make-skill`）、“创建工作流”（`make-workflow`）以及已保存的用户 Skill。来源筛选、分类计数和搜索共同生效；没有分类的旧 Skill 归入“通用”。详情展示完整指令和有序步骤，自建条目保留编辑与启用状态。“用于对话”把准确的 `/name` 调用放到当前输入框草稿前，保留已有文字且不自动发送；没有选中会话时先创建会话。内置内容与运行时注册共用同一份目录。这是本地目录，尚未接入外部商城或下载服务。

“上传 Skill”接受一个 ZIP，根目录或内部文件夹中必须恰好包含一个 `SKILL.md`。YAML 头部必须声明由小写英文、数字和连字符组成的 `name`，以及非空 `description`，正文必须包含执行指令。确认前可在预览中编辑识别出的字段与分类；上传同名 Skill 会在确认后更新原条目。已有条目仍可编辑。原始 ZIP 完整保留脚本、参考资料与资源文件。限制为压缩后 2 MiB、解压后 8 MiB、最多 256 个条目；格式错误、多 Skill、重复路径和路径穿越会被拒绝。上传不会执行包内脚本。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`selectPanel(id)` 在改变选中态前检查实时 `main` 注册表；缺失的 key 会抛错并保留当前面板。`beginNavigation()` 为异步 UI 导航返回 abort signal。后续调用、有效面板选择（包括重复选择）或布局释放会中止该 signal，但不取消底层会话创建。消费方在提交导航或搬移草稿前检查 signal。

一次注册声明四个子 slot，并绑定 `ctx.layout` 的 `selectPanel`、`toggleSidebar`、`openRightbar(track, fullscreen)` 与 `closeRightbar`。同一个 root 存储把 `panelInfo` 选中态与 `layoutInfo` 测量、宽度偏好、呈现报告分开。`usePanelInfo` 订阅引用稳定的选中态对象，AppFrame 订阅引用稳定的布局对象。`rightbar` owner 提供实际 `width`、`viewportWidth`，以及表示能否以普通模式呈现的 `canShow`；占用方在空间不足时执行确定性的收起，变宽不自行重新展开。全屏隐藏宽度手柄，但不自行释放占用方要求保留的轨道。AppFrame 保持各列容器挂载。右栏的 root 控制器仅在选中会话界面时，经 `SessionProvider` 渲染 `rightbar.session`；内容卸载时的报告释放轨道。独立的标题组件仅在会话界面可见时使用所选会话标题，以构建配置的产品标题或本地化 `common.brand.localBuild` 为回退值；语言变化会更新该回退值。主题呈现器是第二个 effect：从解析后的快照做纯 DOM 写入——初始状态经 getter 读取一次，此后仅事件驱动，不经过 React。它先应用调色板、字号与 token 变量，再把渲染出的背景测量为唯一的颜色依据。全屏呈现禁用网格和手柄过渡；占用方完全覆盖框架后才报告新的列布局。退出全屏时，框架先保持无过渡并安装目标布局：关闭移除右轨道，恢复保留右轨道。后续普通几何操作恢复正常过渡。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当布局面不够用时阅读以下页面。它们从框架进入它所渲染的栏与它所呈现的主题。

- [ui-sidebar](../ui-sidebar/README.zh.md)——占据 `sidebar` 栏及其座位。
- [ui-conversation](../ui-conversation/README.zh.md)——占据 `main` 中的 `conversation` key。
- [ui-sidebar-right](../ui-sidebar-right/README.zh.md)——以每会话一个停靠面占据 `rightbar` 栏。
- [ui-theme](../ui-theme/README.zh.md)——呈现器消费其解析快照的主题 seam。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

Host 注册两个内置创建 Skill 和已启用的用户 Skill。名称与描述通过 `tool-skill` 进入技能目录，完整指令按需加载或通过显式 `/name` 调用加载。用户描述包含展示标题，方便自然语言点名匹配。内置 Skill 生成可复用的编辑器内容，不声称已保存或执行。用户工作流和工具返回指令；知识库 Host 负责语义检索及相关工具。

导入的 Skill 保留 `disable-model-invocation` 和 `user-invocable`。首次加载时，Host 再次校验保存的压缩包，将资源解包至设置文件旁，通常为 `$DSH_HOME/skill-imports/<sha256>`，并作为 Skill 资源目录暴露。非文件设置提供方使用进程独立的临时缓存。仅元数据进入目录，附件不会自动注入上下文。“创建 Skill”会生成符合上传格式的 `SKILL.md`，存在文件工具时可以打包。

#### KV Cache 影响

浏览和编辑不发送提供方请求。注册的 Skill 摘要占用目录上下文，加载后的指令占用对话上下文；修改标题或描述可能更新目录。分类属于展示元数据，不进入模型指令。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前布局行为。它们是当前包约束，不是通用窗口管理器对比或任务积压。

- **面板几何是瞬时状态**——重新加载会恢复侧栏默认值并隐藏右侧面板；拖动设置的宽度是整个框架共用的一份偏好，而非每个会话各自的属性。
- **极窄窗口**——右侧面板关闭后，中栏仍可能小于 400px；左侧 56px 控制栏仍会保留。
- **轨道与面板沿同一条曲线运动**——框架的轨道过渡和占用方的滑入读取同一组时长与缓动变量；占用方若自用一套，挤压时面板边缘就会与会话界面的边缘脱开。
- **挤压重排期间无滚动锚定**——布局变化可能移动读者的视口。
- **导入资源位于 Host 本地**——远程或沙箱文件系统需要能够访问该目录才能读取附件。ZIP 导入不安装依赖、不执行脚本，停用条目也不会删除缓存资源。
- **工具统计依赖保留的日志**——新增调用在刷新后显示。已记录工具的说明与参数取自最新可用的请求头，不是实时能力探测；历史和自建条目中均不存在的工具不会显示卡片。历史卡片不保证该工具在当前选择的预设中可用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。外壳中 `ctx.layout` 背后的浏览状态存储不发出 Cordis 事件；clamp 与轨道的时序由本包各栏与服务规格直接断言。
