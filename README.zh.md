# Lingda Harness

[English](README.md) | 中文

Lingda Harness（灵搭）是由 [wxj123-del](https://github.com/wxj123-del) 维护的开源个人 AI 工作台，将对话、可复用的 Skill、工作流和可扩展工具整合到一个 Web 界面中。

项目基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 及其 [Cordis](https://github.com/cordiverse/cordis) 插件架构，扩展了内容编写页面、插件分类，以及可选的媒体生成和 Token 分析工具。

[项目仓库](https://github.com/wxj123-del/lingda_harness) | [使用文档](docs/user/index.zh.md) | [反馈问题](https://github.com/wxj123-del/lingda_harness/issues)

## 功能

- **对话与模型：**配置模型提供方及 OpenAI 兼容端点，选择智能体预设，使用文件与工具完成任务。详见 [Web UI 指南](docs/user/guide/index.zh.md)。
- **Skill 与内容编写：**浏览内置 Skill、导入 Skill ZIP 包，并管理工作流、工具和文本知识库。详见[内容编写与 Skill 导入](packages/client/ui-layout/README.zh.md)。
- **Token 分析：**可选的 Token trace 插件展示请求用量、上下文来源和工具信息，并支持导出 JSON。详见 [Token trace](packages/client/ui-step-insight/README.zh.md)。
- **媒体生成：**可选的[图片](packages/media/image-generation/README.zh.md)与[语音](packages/media/speech-generation/README.zh.md)插件通过已配置的提供方生成内容，并返回附件。

## 开发者预览

Lingda Harness 处于开发者预览阶段，功能和接口仍在迭代，可能出现不兼容变更。可选插件需要单独配置；媒体生成还需要配置对应的提供方。

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

安装 Node.js 24 及以上版本，或 22.x 系列中不低于 22.19 的版本。

### 使用 npx 一键启动

直接运行已发布的 [lingda-harness](https://www.npmjs.com/package/lingda-harness) 包，无需克隆仓库或安装 pnpm：

```sh
npx --registry=https://registry.npmjs.org/ lingda-harness@latest web
```

命令使用 npm 官方源，避免镜像同步延迟。首次启动会下载运行依赖，后续启动复用已安装的运行环境。数据默认存放在 `~/.lingda`。配置与发布细节见[发行包指南](distribution/npm/README.zh.md)。

默认访问地址为 `http://127.0.0.1:3081`，上游 DSH 仍使用 3080 端口。本机启动时会打开浏览器，通过 SSH 启动时只打印宿主机 URL。添加 `--no-open` 可跳过打开浏览器，添加 `--port 3082` 可使用其他端口。按 Ctrl+C 退出。

<a id="run-from-source"></a>

### 从源码运行

如需基于仓库源码开发，还需按照 [package.json](package.json) 的要求安装 pnpm 11.7.0：

```sh
git clone https://github.com/wxj123-del/lingda_harness.git
cd lingda_harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。仓库沿用 `dsh` 命令和 `@deepseek-ai/*` 包名；npm 上的 `@deepseek-ai/dsh` 是上游发行版本。

### 开始第一次对话

1. 打开**设置 → 模型**，按照[模型配置指南](docs/user/guide/providers.zh.md)添加提供方和 API 凭据。
2. 添加并选中一个工作区目录。
3. 创建对话，选择模型并发送任务。

## 文档

- [使用指南](docs/user/index.zh.md)：模型配置、Web UI 和其他使用说明。
- [开发指南](docs/development.zh.md)：本地开发与仓库检查。
- [架构文档](docs/architecture.zh.md)：插件组合与运行时设计。

## 反馈与贡献

请通过[本仓库的 Issues](https://github.com/wxj123-del/lingda_harness/issues)反馈问题和建议。欢迎提交 [Pull request](https://github.com/wxj123-del/lingda_harness/pulls)，并说明问题、改动内容及相关验证结果。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 来源与许可

Lingda Harness 在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的基础上独立维护，保留上游版权声明与 [MIT 许可证](LICENSE)。Cordis 的设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
