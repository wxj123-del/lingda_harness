# Lingda Harness

English | [中文](README.zh.md)

Lingda Harness is an open-source personal AI workspace maintained by [wxj123-del](https://github.com/wxj123-del). It brings conversations, reusable Skills, workflows, and extensible tools into one Web UI.

The project builds on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and its [Cordis](https://github.com/cordiverse/cordis) plugin architecture, with custom authoring pages, plugin organization, and optional media and token-inspection tools.

[Repository](https://github.com/wxj123-del/lingda_harness) | [User guide](docs/user/index.md) | [Report an issue](https://github.com/wxj123-del/lingda_harness/issues)

## Features

- **Conversations and models:** configure providers and OpenAI-compatible endpoints, select agent presets, and work with files and tools. See the [Web UI guide](docs/user/guide/index.md).
- **Skills and authoring:** browse built-in Skills, import Skill ZIP bundles, and manage workflows, tools, and text knowledge bases. See [authoring and Skill import](packages/client/ui-layout/README.md).
- **Token inspection:** an optional Token trace plugin shows request usage, context sources, and tool information, with JSON export. See [Token trace](packages/client/ui-step-insight/README.md).
- **Media generation:** optional [image](packages/media/image-generation/README.md) and [speech](packages/media/speech-generation/README.md) plugins use configured providers and return generated attachments.

## Developer preview

Lingda Harness is in developer preview. Features and interfaces are still evolving, and compatibility-breaking changes are possible. Optional plugins require their own setup; media generation also requires a configured provider.

Review the [safety notice](SAFETY.md) before running the project.

<a id="run"></a>

## Run

Install Node.js 24 or later, or Node.js 22.19 or later within the 22.x line.

### Launch with npx

Run the published [lingda-harness](https://www.npmjs.com/package/lingda-harness) package without cloning the repository or installing pnpm:

```sh
npx --registry=https://registry.npmjs.org/ lingda-harness@latest web
```

The command uses the official npm registry to avoid mirror synchronization delays. First launch downloads runtime dependencies; later launches reuse the installed runtime. Data is stored in `~/.lingda` by default. See the [distribution guide](distribution/npm/README.md) for configuration and release details.

The default address is `http://127.0.0.1:3081`, leaving the upstream DSH default on port 3080. A local launch opens the browser; an SSH launch only prints the host URL. Add `--no-open` to skip opening the browser, or `--port 3082` to use another port. Exit with Ctrl+C.

<a id="run-from-source"></a>

### Run from source

To develop from a repository checkout, also install pnpm 11.7.0 as specified in [package.json](package.json):

```sh
git clone https://github.com/wxj123-del/lingda_harness.git
cd lingda_harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding. This checkout retains the `dsh` CLI and `@deepseek-ai/*` package names; the npm package `@deepseek-ai/dsh` is the upstream distribution.

### First conversation

1. Open **Settings > Models** and configure a provider and API credentials using the [model configuration guide](docs/user/guide/providers.md).
2. Add and select a workspace directory.
3. Start a conversation, choose a model, and send a task.

## Documentation

- [User guide](docs/user/index.md): model setup, Web UI, and other usage guides.
- [Development guide](docs/development.md): local development and repository checks.
- [Architecture](docs/architecture.md): plugin composition and runtime design.

## Feedback and contributions

Report bugs and suggestions in [this repository's Issues](https://github.com/wxj123-del/lingda_harness/issues). Contributions can be submitted through [Pull requests](https://github.com/wxj123-del/lingda_harness/pulls); include the problem, your changes, and relevant validation.

For agents, follow [AGENTS.md](AGENTS.md).

## Origins and license

Lingda Harness is maintained independently on the basis of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). The project retains the upstream copyright notice and [MIT license](LICENSE). The Cordis design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
