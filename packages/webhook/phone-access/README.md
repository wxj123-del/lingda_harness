---
description: "One ngrok tunnel and a scan URL so a phone off the local network can open the running DSH Web GUI."
kind: "package-reference"
---

# @deepseek-ai/dsh-phone-access

English | [中文](README.zh.md)

## Summary

`dsh-phone-access` opens one ngrok tunnel to the running Web GUI and hands the browser a scan URL plus the restart command that admits the tunnel's hostname. The authtoken is a credential, never a setting.

## Configuration

The row takes no keys. Save the ngrok authtoken from **Settings → Connections → Phone access**; it is stored as the credential reference `DSH_NGROK_AUTHTOKEN` and reaches the `ngrok` process only through the `NGROK_AUTHTOKEN` environment variable.

```yaml
- id: phone-access
  name: '@deepseek-ai/dsh-phone-access'
```

Generating a code stops any tunnel this process already holds, starts `ngrok http <web port>`, and reads the https address from `http://127.0.0.1:4040/api/tunnels`. The scan URL is that address with this process's launch token, and the card prints `dsh web --trusted-host <host>`. Quit DSH, run that command, wait until it is up, then scan. This process never restarts itself, and the tunnel ends when the process does.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

### Tunnel status

#### What the model sees

Nothing. Opening a tunnel and returning its scan URL never enters a model request, a prompt, or a tool result. The address stays inside the `phoneAccess` Remote response.

#### Token effect

None. No message is added, removed, or rewritten.

#### KV Cache effect

None. No request prefix changes.

## Known Limitations and Deferred Work

- **Free domain changes each start** — the hostname ngrok assigns is known only after the tunnel starts, and the browser trust list is fixed at process boot, so every new domain needs the printed restart before a scan succeeds.
- **One tunnel per process** — a second generate closes the tunnel the first one opened. Two DSH processes cannot share ngrok's loopback inspector.
- **ngrok must be installed** — the package launches the `ngrok` binary on `PATH` and reports a reason when it is missing, the authtoken is absent, the inspector times out, or the process exits.

No runtime invariant companion is published because phone access owns a transient tunnel and Remote response, not durable replay state.

### Dev Note

The Host plugin owns the tunnel process and returns only the launch URL and restart command through its Remote face.
