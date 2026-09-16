---
description: "Generate speech and save it as a durable audio file through configurable provider routes."
kind: "package-bundle"
---

# dsh-speech-generation

English | [中文](README.zh.md)

## Summary

Generate speech from text and save the result as a durable downloadable attachment. The profile layer exposes `generate_speech` and `list_speech_models`, with configurable providers, voices, formats, and speeds. Provider and model changes stay in configuration.

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

The bundle inserts the `speech-generation` row from [cordis.patch.yml](cordis.patch.yml). It requires tools, attachments, and credentials. Configure one explicit route. Token Plan's DashScope-compatible TTS endpoint uses `api: dashscope-tts` with a `/api/v1` base URL.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shared core selects the route and resolves credentials. Provider adapters translate OpenAI Speech, DashScope, Token Plan DashScope TTS, and Gemini responses. The tool validates the requested format, saves the audio as a file attachment, and returns a file content block.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Shared generation core](../generation-core/README.md) — common routing and accounting.
- [Image generation](../image-generation/README.md) — the parallel image bundle.

## Model Experience

### Generation tool

#### What the model sees

The model receives the `generate_speech` tool. Its result contains the selected `provider`, `model`, `elapsedMs`, raw `usage`, and a saved audio-file reference. The tool renderer adds a `file` block for the generated result.

#### Token effect

The tool schema and each call's text, voice, format, speed, and instructions add tokens according to the selected model route. Provider usage is retained unchanged; binary-only responses leave `usage` as `null`.

#### KV Cache effect

The tool result appends to the conversation and preserves earlier request content. Enabling or removing the tool changes the tool prefix. The provider speech request is independent of the agent request and has no shared KV cache.

## Known Limitations and Deferred Work

- The current `ContentBlock` vocabulary has image and file blocks but no audio block, so the plugin returns an audio file attachment; inline playback requires coordinated session, transport, and client changes.

<a id="dev-note"></a>
### Dev Note

Real provider access requires the corresponding subscription credentials; Loader and adapter tests use deterministic local HTTP fixtures.
