---
description: "Generate, edit, save, and display images through configurable provider and model routes."
kind: "package-bundle"
---

# dsh-image-generation

English | [中文](README.zh.md)

## Summary

Generate one image from a prompt or edit local reference images, then save the result as a durable attachment. The profile layer exposes `generate_image` and `list_image_models`, and the existing conversation renderer displays the generated image. Switch subscriptions by changing provider and model configuration.

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

The bundle inserts the `image-generation` row from [cordis.patch.yml](cordis.patch.yml). It requires tools, attachments, and credentials; local reference paths also require a filesystem provider. Configure one explicit route.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shared core selects the route and resolves credentials. Provider adapters translate OpenAI Images, Volcano, DashScope/Wan, and Gemini requests. The tool validates reference images, saves both an image attachment and the original file, then returns image and file content blocks.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Shared generation core](../generation-core/README.md) — common routing and accounting.
- [Speech generation](../speech-generation/README.md) — the parallel audio bundle.

## Model Experience

### Generation tool

#### What the model sees

The model receives the `generate_image` tool. Its result contains the selected `provider`, `model`, `elapsedMs`, raw `usage`, saved image metadata, and saved original-file metadata. The tool renderer adds an `image` block and a `file` block for the generated result.

#### Token effect

The tool schema and each call's prompt, optional size, aspect ratio, and reference-image data add tokens or image input according to the selected model route. Provider usage is retained unchanged; absent usage is `null`, never an estimated zero.

#### KV Cache effect

The tool result appends to the conversation and preserves earlier request content. Enabling or removing the tool changes the tool prefix. The provider generation request is independent of the agent request and has no shared KV cache.

## Known Limitations and Deferred Work

- Reference images currently accept local files or data URLs; existing attachment references are not yet accepted directly.

<a id="dev-note"></a>
### Dev Note

Real provider access requires the corresponding subscription credentials; Loader and adapter tests use deterministic local HTTP fixtures.
