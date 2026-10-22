---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-01-session-format-v4

English | [中文](2026-10-01-session-format-v4.zh.md)

## Summary

The current Session writer moves from format v3 to v4. The release keeps the V3 physical framing and event chronology, while acknowledging new Feishu message-source variants, workflow schedule version 2 payloads, and the current writer header version.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-01-session-format-v4
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-11-initial"
    after: "1a3440e3577382704d42a6263aa463504eb74c566734a55e9503a63efcd02445"
    decision: version-bump
  - root: "event:agent/git-checkpoint"
    previous: null
    after: "c555ad0edd8ac898d69feea20b054aa1720d2efa4ae4b65be69f5b2ae0913c70"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-14-image-offload"
    after: "114fd6c87df77706e92e7e38e18092653ca092cb785d37e9bc087bb5c97e16ae"
    decision: version-bump
  - root: "event:agent/mode"
    previous: null
    after: "b35ceaaccf4e97b9051dce0f8d2caaef86abe66012a42c01b076f1a3a3fc6faa"
    decision: version-bump
  - root: "event:agent/request-context"
    previous: null
    after: "bbae7a06c6d6a0c6d564389db65fe37975ae248152c931d04b59da9d6e16035a"
    decision: version-bump
  - root: "event:agent/tool-denied"
    previous: null
    after: "95a88c6c191f903e893fb0f2cc59d22267e8e81aa1ab62ed1ba064811bc439f7"
    decision: version-bump
  - root: "event:context/calibration"
    previous: null
    after: "49095060824d56fc0f640ea2c29ca9e43cc7b9c04deeadf1e179e7092e11fb1d"
    decision: version-bump
  - root: "event:context/router"
    previous: null
    after: "bb7fe4c07667dd19ddaf95f78a457ac33af270c756c35a9116b6eff357cebec2"
    decision: version-bump
  - root: "event:knowledge/retrieval"
    previous: null
    after: "0c54f7f4cb8eda46c3e4818f5297f93f382dc251a95d49e21b0171333cb4bffd"
    decision: version-bump
  - root: "event:knowledge/selection"
    previous: null
    after: "fb1388960c87089798fe6f094a0ad0afaed619f13cdf7b138aa1f452fcd510c5"
    decision: version-bump
  - root: "event:schedule/change"
    previous: "2026-09-11-initial"
    after: "6994abb4371f4ed5044d3feb0a492a2050237563e6d26c6cf3e9d9d94857103c"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-14-image-offload"
    after: "71525775c8828e00ba831ceab8140fe0828ee62c26b7c2e9a56eb7e883217928"
    decision: version-bump
  - root: "event:task/cancelled"
    previous: null
    after: "c2517349361edf26b29f088bbb2b3dc4a255d6f98cf5845492c679c52ff1cef4"
    decision: version-bump
  - root: "event:task/created"
    previous: null
    after: "a5c054e888fe194baa2ff9ede075fa0724041e964784ab12e16be2f440af05f1"
    decision: version-bump
  - root: "event:task/failed"
    previous: null
    after: "1969f58989122497d3d8e1731940f7b34b2bf015441fd72a6afd2f06c4693538"
    decision: version-bump
  - root: "event:task/planned"
    previous: null
    after: "4aa65dac12a686eeaeeabc727b383da3d8619c5ff0c98a9bc6aa0e4c420eaed1"
    decision: version-bump
  - root: "event:task/running"
    previous: null
    after: "2dde4581e88305e75afe04f8dde5b601b09be267131b7cce1a5c78f8be916c72"
    decision: version-bump
  - root: "event:task/succeeded"
    previous: null
    after: "052e010d8aacaf68bff0313a0e25bf21d21395010ffd3320b23260017751cf3e"
    decision: version-bump
  - root: "event:task/waiting-human"
    previous: null
    after: "a4d4b0db312ffa29b34e21c22f1f7bcf32305b447f5c2220edab34bce18ec765"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-14-image-offload"
    after: "33d7360537702223e68e495f2b05befe9692cc7724837ec3b4fbe897bae468ca"
    decision: version-bump
  - root: "event:visual-workflow/node"
    previous: null
    after: "ff2ee66479a0a60bd141972b78adf9c8bfca4b36d262ca17c8c234f15d78dc76"
    decision: version-bump
  - root: "event:visual-workflow/run"
    previous: null
    after: "e5f1783273336e038605b79bbb69e2e569cf19f9ba8f3d604672ffb1b0f0dbc2"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

Readers must use the adjacent v3-to-v4 identity migration before applying the current Session validator. The migration preserves event identities, payloads, source coordinates, and inherited cuts; V4 validation accepts the audited Feishu source shape and workflow schedule payload without rewriting them. V3 files remain readable through the complete v0-to-v4 chain, while a file stamped with a newer version is still refused.

<a id="verification"></a>
## Verification

Validated with the generated persistence catalog, the v3-to-v4 codec and migration tests, Feishu physical round-trip coverage, workflow schedule restoration coverage, TypeScript project checks, and the persistence-change verifier. The V4 writer and catalog are generated from the same current-version declaration and the acknowledgement records the required increasing SessionHeader.version transition.

<a id="dev-note"></a>
## Dev Note

None.
