---
description: "Shared configuration and bounded transport for image and speech generation providers."
kind: "package-reference"
---

# @deepseek-ai/dsh-generation-core

English | [中文](README.zh.md)

## Summary

Use this library to validate media provider configuration, select one declared model route, resolve credentials per operation, and bound provider responses. The image and speech plugins consume it. It does not register a Cordis plugin surface on its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import the shared configuration schema and route helpers from the package entry point. `selectRoute` rejects zero or multiple matches. `transport` resolves the current credential, rejects unsafe endpoints and redirects, and limits response bytes. Provider usage remains `null` when the provider does not report it.

For results hosted outside the API origin, set `providers.<id>.downloadHosts` to exact provider-documented CDN hostnames. Downloads omit API credentials. An untrusted-host error names the provider and hostname without exposing the result path or signed query; add the verified hostname to that provider's configuration.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The core owns configuration validation, route selection, bounded reads, trusted result downloads, cancellation, and raw accounting. Protocol adapters remain in the image and speech packages, so provider-specific changes stay isolated. No invariant companion is published because this library keeps no derived state that can diverge from the session log.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Image generation](../image-generation/README.md) — image adapters and the `generate_image` tool.
- [Speech generation](../speech-generation/README.md) — speech adapters and the `generate_speech` tool.

Shared runtime for media generation plugins. It validates subscription configuration, selects one declared provider/model route, resolves credentials per request, bounds response bytes, rejects unsafe redirects, and retains provider usage without inventing token counts.

## Model Experience

None, as shared media configuration and HTTP helpers register no prompt, tool, or session event.

#### KV Cache effect

No direct effect; provider selection and transport run only when an owning generation tool is called.

## Known Limitations and Deferred Work

- Provider implementations remain owned by the image and speech packages so protocol differences stay isolated.

<a id="dev-note"></a>
### Dev Note

None.
