# Feishu Bot Remote Chat

English | [中文](feishu-bot.zh.md)

The Web app includes a Feishu bot so a phone can chat with a Lingda Harness Agent through a Feishu custom-app bot. It uses Feishu's outbound WebSocket long connection by default, so the computer does not need a public IP, inbound port, HTTPS callback, or the same Wi-Fi as the phone. Command-line users can still use the overlay shown below.

For the complete message path from Feishu to the Agent and back, see the [end-to-end Feishu bot article](feishu-bot-end-to-end.md).

## Prerequisites

- A Feishu Open Platform enterprise custom app with the bot capability enabled.
- The `im.message.receive_v1` event subscription enabled, using Feishu's **long connection** mode for the default transport.
- The app's `App ID` and `App Secret`. An event `Verification Token` is needed only if you choose HTTP webhook transport.
- A local DSH workspace and a permission preset appropriate for remote use.

## Configure in Settings

The Web app includes the Feishu bot connector. Open **Settings -> Connections -> Feishu bot**, enter the App ID, App Secret, workspace path, agent preset, and permission preset (start with `read-only`), then choose whether group chats require an `@` mention.

Save the settings and restart DSH. The bot connects to Feishu through an outbound WebSocket, so the phone does not need to share a network with the computer and the computer does not need a public inbound port.

## Configure from the command line (optional)

Export credentials without putting their values in the patch:

```sh
export DSH_FEISHU_APP_ID='cli_xxx'
export DSH_FEISHU_APP_SECRET='replace-with-app-secret'
export DSH_FEISHU_WORKSPACE=/path/to/your/workspace
```

Start DSH with the included overlay:

```sh
pnpm run dsh web --patch apps/cli/config/examples/feishu-bot/cordis.yml
```

In Feishu, open the bot's private chat or add it to a group. Private messages create one Agent Session per sender; group messages create one per chat and require `@机器人` by default. Replies are sent after each completed model turn.

## Safety

Start with `permissionPreset: read-only`. Add sender IDs to `allowedOpenIds` before enabling a broader tool policy. The bot has the same local workspace access as the selected Agent composition, so do not expose execution-capable presets to an untrusted enterprise tenant or group.

The chat-to-Session map and duplicate-event cache are process-local in this version. Restarting DSH drops the live mapping; durable resume, rich cards, media, and streaming replies are deferred.

## HTTP callback alternative

Set `transport: webhook` to use an HTTP callback at `/feishu`. That mode requires a public HTTPS URL and leaves HTTP encrypted callback bodies unsupported in this version; WebSocket is the recommended remote-work mode.
