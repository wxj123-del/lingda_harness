---
description: "Frozen released-v3 Session reader and identity migration into released v4."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

English | [中文](README.zh.md)

## Summary

`dsh-session-format-v3-to-v4` releases the unchanged logical V3 Session language under a new format version. The V4 codec reuses the V3 physical framing and event encoding, while the adjacent streaming migration changes only the header version and preserves event order, identities, payloads, and inherited cuts.

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

### When to use it

Persistence obtains this edge through `dsh-session-format-catalog`; applications do not mount it as a plugin. Import it directly when assembling or testing the static released-format catalog or when checking the V3-to-V4 compatibility boundary.

### Entry point

```text
const targetHeader = sessionFormatV3ToV4.migrateHeader(sourceHeader)
const stage = sessionFormatV3ToV4.createStage({ sourceHeader, targetHeader, sourceInheritedEventCount, sourceKind: 'decoded' })
stage.transformEvent(event, migrationContext)
const inheritedEventCount = stage.finish(migrationContext)
const headerRecord = releasedV4SessionFormatCodec.encodeHeader(targetHeader, inheritedEventCount)
const eventRecord = releasedV4SessionFormatCodec.encodeEvent(event)
```

`releasedV4SessionFormatCodec` accepts only V4 headers, then delegates the physical row rules to the frozen V3 codec after a private version translation. `sessionFormatV3ToV4` is an identity body stage: it preserves every admitted event and verifies dense order and the seeded inherited cut. `restoreReleasedV4Artifact` applies the released V3 relationship and payload validation without exposing a private V3 view.

The version bump is intentional even though the physical layout is unchanged. It records the current persistence schema acknowledgement for newly admitted message-source variants and workflow schedule payloads; future readers can therefore refuse a newer writer version instead of guessing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/codec.ts`](src/codec.ts) | V4 header boundary and V3 physical framing delegation |
| [`src/migration.ts`](src/migration.ts) | Streaming identity conversion and inherited-cut validation |
| [`src/validation.ts`](src/validation.ts) | V4 header and artifact validation through frozen V3 rules |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Released V2 to V3 edge](../session-format-v2-to-v3/README.md) — the source codec and logical contract reused here.
- [Static catalog](../session-format-catalog/README.md) — build-owned codec and migration ordering.
- [Session persistence subsystem](../../../docs/subsystems/persistence.md) — generation selection and successor publication.

-----

<a id="model-experience"></a>
## Model Experience

### Historical restoration

#### What the model sees

The model sees the same restored messages, tools, metadata, and event relationships as it would from the released `V3` artifact; this edge changes no logical content.

#### Token effect

No model-visible tokens are added, removed, or reinterpreted by the identity migration.

#### KV Cache effect

The logical request prefix is unchanged, so this version boundary alone does not alter cache identity.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Physical-layout reuse** — V4 intentionally reuses V3 framing; a future physical change requires a separate codec and migration edge.
- **No publication** — persistence owns successor-file publication and atomic replacement; this package only supplies pure codecs and migration functions.

No runtime invariant companion is published because this package is a pure format codec and migration edge.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
