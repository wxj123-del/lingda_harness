---
description: "The media capability group: shared provider routing plus image and speech generation bundles."
kind: "package-group"
---

# media/ — media generation capability family

English | [中文](README.zh.md)

## Summary

The media group provides configurable image and speech generation. `generation-core` owns route selection, credential resolution, bounded downloads, and provider usage accounting; `image-generation` and `speech-generation` add the model-facing tools and durable attachments. Each package README owns its configuration and provider contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`generation-core/`](generation-core/README.md) | Shared media routes, credentials, bounded transport, and usage accounting | library |
| [`image-generation/`](image-generation/README.md) | Image generation and editing with durable image and source-file attachments | registers model tools |
| [`speech-generation/`](speech-generation/README.md) | Speech generation with durable audio-file attachments | registers model tools |

<a id="related-documentation"></a>
## Related documentation

- [Image generation package](image-generation/README.md) — image providers and `generate_image`.
- [Speech generation package](speech-generation/README.md) — speech providers and `generate_speech`.
- [Attachment package](../attachment/README.md) — durable file and image references returned by the bundles.

<a id="dev-note"></a>
## Dev Note

Provider tests use deterministic local HTTP fixtures; live generation requires the credentials for the selected provider.
