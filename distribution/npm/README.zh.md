# Lingda Harness npm 发行包

[English](README.md) | 中文

本目录提供 `lingda-harness` npm 包。发行归档包含本地构建的 CLI、Web 界面、插件、Cordis 包的归档和许可证声明。首次启动时，启动器校验这些归档并通过 npm 安装它们、外部依赖及适合用户平台的可选原生二进制包。首次启动需要联网，之后复用已安装的运行时。

## 构建与验证

在仓库根目录使用 Node.js 24 和 pnpm 11.7.0 执行：

```sh
pnpm install --frozen-lockfile
pnpm run release:lingda
```

该命令使用 Lingda Harness 标题构建 Web 界面，并输出 `dist/lingda/lingda-harness-0.1.0.tgz`。`pnpm run pack:lingda` 可重新打包已有且校验通过的 Lingda 构建。请在仓库以外的目录验证归档：

```sh
npx --yes /absolute/path/to/lingda-harness-0.1.0.tgz --version
npx --yes /absolute/path/to/lingda-harness-0.1.0.tgz web --no-open
```

打开 `http://127.0.0.1:3081` 并配置模型提供方。按 Ctrl+C 退出。归档验证使用安装后的产品，不依赖工作区链接或源码构建工具。

## 发布

登录将拥有 `lingda-harness` 的 npm 账号，然后发布已验证的归档：

```sh
npm login --registry=https://registry.npmjs.org/
npm publish dist/lingda/lingda-harness-0.1.0.tgz --access public --registry=https://registry.npmjs.org/
```

发布后，用户只需安装受支持的 Node.js 并准备自己的模型凭据：

```sh
npx lingda-harness@latest web
```

不传参数时默认运行 `web`。`--version` 输出 Lingda 发行包版本，不安装运行时依赖；其他参数交给现有 CLI。默认数据目录为 `~/.lingda`，显式设置的 `DSH_HOME` 可以覆盖它。已有的 `~/.dsh` 数据不会自动迁移。数据目录内的运行时缓存按发行内容、平台和 Node ABI 隔离。中断的安装不会留下完成标记，下次启动会重新尝试。

准备新版本前，请递增 [package.json](package.json) 中的版本号。只发布生成的归档，源码包会拒绝直接发布。内部 `@deepseek-ai/*` 包随发行包一起打包，`pack:lingda` 不会发布这些包。可选媒体插件仍需配置后才能使用。
