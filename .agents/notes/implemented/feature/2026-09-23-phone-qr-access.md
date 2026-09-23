# Agent Note: Phone QR access

Status: implemented

English | [中文](2026-09-23-phone-qr-access.zh.md)

## Problem

The Web GUI accepts connections from the machine it runs on, and `--mobile` only reaches a phone on the same trusted network. Using DSH from a phone on another network needed a public address, while the free ngrok hostname is assigned only after a tunnel starts and the browser trust list is fixed when the process boots.

## Decision

`packages/webhook/phone-access` opens one ngrok tunnel to the running Web port. The Web bundle composes it, and the browser registers a **Phone access** card on `settings.integration.item` directly after the Feishu card under **Settings → Connections**.

The authtoken is the credential reference `DSH_NGROK_AUTHTOKEN`. It never enters the settings document, an argument list, a log line, or the QR payload, and it reaches `ngrok` only through the `NGROK_AUTHTOKEN` environment variable. Generating a code stops the tunnel this process already holds, launches `ngrok http <port> --log=stdout`, and reads the first `https` tunnel from `http://127.0.0.1:4040/api/tunnels`. The scan URL is that origin plus this process's launch token, built by `connection.authenticatedUrl`, so the token leaves only for a browser that is already signed in. The card also shows `dsh web --trusted-host <host>` and tells the user to quit DSH, run it, and scan after it is up.

The tunnel ends when the fiber is disposed. This process never restarts itself: a restart would kill the tunnel and rotate the free hostname.

## Alternatives considered

### Why not print the QR in the terminal?

The request was to scan from the phone and to find the control under **Settings → Connections**, beneath the Feishu row. A terminal QR is invisible from the settings page the user opens.

### Why not restart DSH from the card?

Restarting replaces the process, which closes the tunnel and assigns a new free hostname, so the address just printed would already be wrong. The trust list is sampled once at boot, so the card prints the restart command and leaves the restart to the user.

### Why not a fixed paid domain or a relay?

A paid reserved domain and a ZCode-style relay both add an account and a service this deployment does not have. The free tier plus one restart per new hostname covers the stated case.

## Consequences

A phone off the local network can open the GUI, at the cost of installing ngrok and restarting DSH before each scan. One process holds one tunnel, and two processes cannot share the loopback inspector. The QR payload is a login key for that process; the card says not to share it.
