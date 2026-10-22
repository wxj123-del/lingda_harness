---
description: "Feishu bot callback adapter that routes mobile chat messages to per-chat DeepSeek Harness Agent Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-feishu

English | [中文](README.zh.md)

## Summary

`dsh-webhook-feishu` connects a Feishu custom app bot to DeepSeek Harness Agent Sessions. Its default WebSocket long connection needs only outbound HTTPS/WSS and no public callback route; its optional HTTP transport registers an exact callback route, handles URL verification, validates the verification token, and parses text messages. In both modes it reuses one Agent Session per chat and sends completed assistant text back through Feishu.

## Table of Contents

- [Configuration](#configuration)
- [HTTP contract](#http-contract)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Configuration

| Key | Meaning |
|---|---|
| `path` | Exact callback pathname, default `/feishu`. |
| `transport` | `websocket` (default, recommended) for outbound Feishu long connection, or `webhook` for HTTP callbacks. |
| `appIdEnv` / `appSecretEnv` | Credential references for the Feishu custom app. |
| `verificationTokenEnv` | Credential reference for the Feishu event verification token; required only for `webhook` transport. |
| `encryptKeyEnv` | Optional signature key. Encrypted callback bodies are intentionally rejected in this first adapter; leave encryption disabled or use the future long-connection adapter. |
| `workspacePath` | Absolute workspace shared by the Feishu chat Agents. |
| `agentPreset` / `permissionPreset` | Agent composition and tool-safety policy. |
| `allowedOpenIds` | Optional user allowlist; empty means every verified sender. |
| `requireMention` | Require a bot mention in group chats; defaults to `true`. |

Example:

```yaml
- id: feishu-bot
  name: '@deepseek-ai/dsh-webhook-feishu'
  config:
    path: /feishu
    appIdEnv: DSH_FEISHU_APP_ID
    appSecretEnv: DSH_FEISHU_APP_SECRET
    workspacePath: !!js process.cwd()
    agentPreset: standard
    permissionPreset: read-only
```

For the default `websocket` transport, enable the bot, choose Feishu's long-connection event mode, and subscribe to `im.message.receive_v1`; no public callback URL or verification token is needed. For `webhook`, configure the Feishu app's event subscription URL to the public HTTPS URL ending in `/feishu` and provide `verificationTokenEnv`. Direct messages are routed by `open_id`; group messages are routed by `chat_id`. The first message creates a Session, later messages in the same chat reuse it.

## HTTP contract

Only `POST` is accepted. `url_verification` returns the challenge after token validation. Message events return `202` before Agent execution; model replies are sent asynchronously. Invalid tokens return `401`, oversized bodies return `413`, and missing credentials return `503`.

## Model Experience

### Feishu chat turns

#### What the model sees

Each accepted text message becomes an ordinary user-role message in the mapped `Agent Session`, with the Feishu chat as transport metadata rather than hidden prompt text.

#### Token effect

One user message is retained per accepted turn and contributes tokens until ordinary compaction removes or summarizes that history.

##### Slash commands

```markdown
Registered slash commands such as `/mode qa`, `/mode coding`, and `/compact` execute before the Agent loop; they do not start a model turn. Unknown slash commands return an admission error instead of being sent to the model. Unambiguous Chinese mode phrases map to `/mode`; ordinary text remains model-visible conversation input.
```

#### KV Cache effect

Append-only after the existing Session prefix; a repeated chat keeps the reusable prefix and adds only the new turn.

##### Reply rendering

```markdown
Assistant replies are sent as Feishu post messages with a Markdown element, rather than plain-text messages. Headings, emphasis, lists, tables, links, and fenced code therefore render in Feishu's rich-text surface. Long replies are split at line boundaries before sending.
```


## Known Limitations and Deferred Work

- **HTTP encryption disabled** — encrypted HTTP callback bodies are not decrypted in this version; the default WebSocket transport avoids this limitation.
- **In-memory chat map** — chat-to-Agent bindings are lost on process restart; persisted-session resume is deferred. In-process duplicate event ids are bounded to 2048 entries.
- **Plain text replies** — rich cards, files, images, and streamed partial replies are deferred.

No runtime invariant companion is published because the webhook adapter owns ingress validation and delivery, not a durable replay invariant.

### Dev Note

The adapter owns Feishu ingress verification, command short-circuiting, Session lookup, and reply delivery; the shared Agent and Session services remain the execution authority.
