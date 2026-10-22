# Phone QR access for DSH

English | [中文](2026-09-23-phone-qr-access-design.zh.md)

## Purpose

On the Settings "Connection services" page, add a "Phone access" card immediately below the Feishu bot row. A phone on another network scans the QR code and opens the DSH Web interface running on this computer.

The public entry point uses the free ngrok tier. The free hostname is chosen at each start, while DSH's browser trust list is fixed at process startup, so the user must restart DSH with the command shown by the card before scanning the generated QR code.

## Card

The card reuses the existing `PluginCard`: collapsed, it shows one title row, one description row, and an arrow; clicking expands it. It registers at `settings.integration.item`, immediately after the Feishu card.

When collapsed:

- Title: Phone access
- Description: Scan on a phone on another network to open this DSH.

When expanded, from top to bottom:

1. An ngrok authtoken input. It is written to the DSH credential store under the reference name `DSH_NGROK_AUTHTOKEN`, not to the settings document.
2. A "Generate QR code" button. It is disabled without a token.
3. A generating status, with one reason line on failure.
4. After success, a QR code whose content is `https://<ngrok hostname>/?token=<login token for this process>`. Beside it, state that this code is equivalent to a login key and must not be shared.
5. A copyable restart command: `dsh web --trusted-host <ngrok hostname>`. Explain that the user must quit DSH, run this command, wait for it to start, and then scan.

## Behavior

One Host plugin owns the tunnel, and one process opens at most one tunnel.

- When "Generate QR code" is clicked and a tunnel already exists, stop the existing tunnel first.
- The plugin starts `ngrok http <port>` for the process's Web port. The authtoken reaches ngrok only through its environment or configuration; it never appears in the QR code or logs.
- Read the public address from ngrok's local `http://127.0.0.1:4040/api/tunnels` endpoint and accept only its `https://` tunnel. A timeout or missing address is a failure whose reason is shown in the card.
- Reuse the process's existing startup login token; do not issue a second credential.
- Closing the card, leaving the page, or exiting DSH stops the tunnel, and invalidates the QR code.
- DSH does not restart itself. Restarting kills ngrok, so the free hostname changes.

## Out of scope

- Paid ngrok fixed hostnames.
- Binding DSH to `0.0.0.0` or changing the existing cookie authentication.
- Printing the QR code in a terminal. `scripts/dsh-phone.sh` is removed.
- Operating the phone or adding a ZCode-style relay.

## Failure

- If `ngrok` is absent, the card tells the user to install it and log in first.
- If the authtoken is invalid, the tunnel times out, or the local endpoint has no HTTPS address, the card shows one reason and no QR code.
- If the user scans before restarting, the hostname is not in the trust list and DSH rejects the request. The card explains "restart before scanning" as a required step instead of adding another probe.
