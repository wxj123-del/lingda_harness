# Lingda Harness npm distribution

English | [中文](README.zh.md)

This directory supplies the `lingda-harness` npm package. The release archive includes tarballs of the built local CLI, Web UI, plugins, Cordis packages, and license notices. On first launch, the launcher verifies their checksums and runs npm to install them with external dependencies and optional native binaries for the user's platform. First launch needs network access; later launches reuse the installed runtime.

## Build and verify

Run from the repository root with Node.js 24 and pnpm 11.7.0:

```sh
pnpm install --frozen-lockfile
pnpm run release:lingda
```

The command builds the Web UI with the Lingda Harness title and writes `dist/lingda/lingda-harness-0.1.0.tgz`. `pnpm run pack:lingda` repacks an existing verified Lingda build. Test the archive from a directory outside this checkout:

```sh
npx --yes /absolute/path/to/lingda-harness-0.1.0.tgz --version
npx --yes /absolute/path/to/lingda-harness-0.1.0.tgz web --no-open
```

Open `http://127.0.0.1:3080` and configure a model provider. Exit with Ctrl+C. Testing the archive uses the installed product without workspace links or source build tools.

## Publish

Authenticate with the npm account that will own `lingda-harness`, then publish the verified archive:

```sh
npm login --registry=https://registry.npmjs.org/
npm publish dist/lingda/lingda-harness-0.1.0.tgz --access public --registry=https://registry.npmjs.org/
```

After publication, users need only a supported Node.js installation and their model credentials:

```sh
npx lingda-harness@latest web
```

No arguments defaults to `web`. `--version` prints the Lingda distribution version without installing runtime dependencies. Other arguments pass to the existing CLI. The default data directory is `~/.lingda`; an explicit `DSH_HOME` overrides it. Existing `~/.dsh` data is not migrated automatically. Runtime caches under that data directory are separated by release contents, platform, and Node ABI. An interrupted install leaves no completed cache and is retried at the next launch.

Increment the version in [package.json](package.json) before preparing another release. Publish only the generated archive; the source package rejects direct publication. Internal `@deepseek-ai/*` packages are bundled locally and are never published by `pack:lingda`. Optional media plugins still need configuration before use.
