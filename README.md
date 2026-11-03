<!-- markdownlint-disable-next-line MD041 -->
<a id="top"></a>

<div align="center">

<img width="72" alt="The Gentle neon rose" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-dot/main/docs/assets/brand/rose.png" />

<h1>dot-telegram</h1>

<p><strong>Your Gentle Dot assistant, one Telegram message away.</strong></p>

<p>
<img src="https://img.shields.io/badge/status-prototype-F095C8?style=for-the-badge&labelColor=1A1218" alt="Status: prototype">
<img src="https://img.shields.io/badge/Gentle%20Dot-protocol%20v1-F095C8?style=for-the-badge&labelColor=1A1218" alt="Gentle Dot protocol v1">
<img src="https://img.shields.io/badge/Bot%20API-10.3-D7A0B8?style=for-the-badge&labelColor=1A1218" alt="Telegram Bot API 10.3">
<a href="#development"><img src="https://img.shields.io/badge/tests-121%20offline-D7A0B8?style=for-the-badge&labelColor=1A1218" alt="121 offline tests"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/MIT-D7A0B8?style=for-the-badge&labelColor=1A1218" alt="License: MIT"></a>
</p>

<p>
<a href="#get-started"><strong>Get started</strong></a> &bull;
<a href="#security"><strong>Security</strong></a> &bull;
<a href="#troubleshooting"><strong>Troubleshooting</strong></a> &bull;
<a href="https://github.com/Gentleman-Programming/gentle-dot"><strong>Gentle Dot</strong></a>
</p>

<br/>

<p>
Gentle Dot lives on your desktop or your server. You do not always.
<strong>dot-telegram lets you talk to the same assistant, with the same memory, from the chat app already on your phone.</strong>
</p>

</div>

<br/>

> [!WARNING]
> **Prototype.** dot-telegram talks to Gentle Dot's client protocol v1 (gentle-dot `535e7f7`), which is not a published API and may change. It relays an assistant that can act on your behalf: read [Security](#security) before you run it.

<br/>

<div align="center"><img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-dot/main/docs/assets/brand/rose.png" width="28" alt="" /></div>

## Features

---

### Opt-in, by design

dot-telegram is a separate process, not a Gentle Dot feature. It joins the daemon as one more client, exactly like a browser window, and Gentle Dot itself does not change. Do not run it, and it does not exist: no code loaded, no port opened, no token stored.

---

### One conversation, everywhere

Your messages land in the same conversation as the desktop app and the web page, with the same memory. Answers come back only for the messages you sent from Telegram, so the work you do at your desk stays there.

---

### Live status you can stop

While the assistant works, Telegram shows a live status, "Thinking…" or what it is doing right now ("Checking my notes…"), with a native stop button. The final answer arrives as a normal message, split when it is longer than Telegram allows.

---

### Choose your model

Use `/model` to see the current LLM and choose from the models available to your connected accounts. Buttons are grouped by account and paginated; **Previous**, **Next**, and **Close** navigate without sending a chat message. The bot confirms the daemon's reported state, not merely that a button was pressed.

The choice is **shared with the web and desktop clients** and saved as the default, not isolated to your Telegram chat. A choice made during a reply waits until that reply finishes. Compatible thinking levels carry over; this command does not configure subagent models, profiles, or accounts.

If a request cannot be confirmed within 15 seconds or the connection drops, it is not retried. Use `/model` again to check the actual state. Open menus follow changes made from the web; old buttons expire after a refresh or disconnect. Only one local model request is processed at a time.

#### Try it from Telegram

1. Open your existing private bot chat and send `/help` to check that `/model` is listed.
2. Send `/model`. Check the **Current model** and, if present, **Pending model**. The active model has a **✓** button.
3. Choose a model using its button; use **Next** and **Previous** for more options. **Close** dismisses the menu without changing anything.
4. Wait for **Current model** to confirm the choice, or **Pending model** if the assistant is still replying. Reopen `/model` or the web selector to check the shared state.
5. Send a normal message to try the chosen model. You can return to the previous model with `/model`.

Changing the model may change provider usage or billing. Merely opening or closing the menu does not change the model.

---

### Questions, answered with a tap

When the assistant asks, you answer from the chat: **Allow** or **Decline**, one button per choice, or a typed reply. Actions that send or change something in your accounts are never approved from Telegram: you are told where to approve them.

---

### Voice notes

Record a voice note. Gentle Dot transcribes it, the bot shows you what it heard ("🎙️ …"), and sends it on. Transcription uses Gentle Dot's OpenAI API key.

---

### Files

Send a document, photo, video, or audio file. The bot uploads it to Gentle Dot and sends it to the assistant with its caption as your message. Telegram lets bots download files up to 20 MB, so larger files are refused before anything is downloaded.

<div align="right"><a href="#top">Back to top</a></div>

<div align="center"><img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-dot/main/docs/assets/brand/rose.png" width="28" alt="" /></div>

## What you can do from Telegram

| In Telegram | What happens |
| :--- | :--- |
| Write a message | The assistant gets it; a live status shows its progress |
| Write while it works | Your message steers the run already going |
| The stop button, or `/stop` | Stops what the assistant is doing |
| `/model` | Shows the current/pending model and offers model-selection buttons; shared with the web and saved as the default |
| Send a voice note | Transcribed, shown back as "🎙️ …", then sent |
| Send a file, photo, video, or audio | Uploaded to Gentle Dot and sent with its caption (up to 20 MB) |
| A question with choices | Buttons: **Allow** / **Decline**, or one per option plus **Cancel** |
| A question that needs text | Your next message is the answer; `/cancel` cancels it |
| An action that sends something (desktop) | "Approve this in the Gentle Dot desktop app." |
| An action that sends something (server) | Approve it with your PIN on the Gentle Dot web page |
| `/start`, `/help` | A short explanation |

<div align="right"><a href="#top">Back to top</a></div>

<div align="center"><img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-dot/main/docs/assets/brand/rose.png" width="28" alt="" /></div>

## Get started

### What you need

- **Node.js 22.18 or later**, on the machine where Gentle Dot runs.
- **Gentle Dot running**, as the desktop app or as a server (`docker compose`).
- **A Telegram bot** and your **numeric Telegram user id**.

### 1. Create the bot

1. In Telegram, talk to [@BotFather](https://t.me/BotFather), send `/newbot`, and follow the steps. Keep the token it gives you (`123456789:AA…`).
2. Send any message to [@userinfobot](https://t.me/userinfobot): it answers with your numeric id.
3. Open a chat with your new bot and press **Start**, so it is allowed to write to you.

### 2. Install

```sh
git clone https://github.com/danielgap/dot-telegram.git
cd dot-telegram
npm ci
```

### 3. Find the access key

The bot signs in to Gentle Dot with the daemon's access key.

| Gentle Dot runs as | The access key |
| :--- | :--- |
| Desktop app (macOS, Linux) | Already at `~/.gentle-dot/token`: nothing to do |
| Server with `docker compose` | Inside the container, readable by root only. Copy it out, once: |

```sh
mkdir -p ~/.config/dot-telegram && chmod 700 ~/.config/dot-telegram
# from the folder with Gentle Dot's compose.yaml
docker compose exec -T gentle-dot cat /home/dot/.gentle-dot/token > ~/.config/dot-telegram/token
chmod 600 ~/.config/dot-telegram/token
```

The key lives in Gentle Dot's `dot-home` volume, so it survives restarts.

### 4. Configure

Keep the settings in a `.env` file only you can read, so the token stays out of your shell history:

```sh
cat > .env <<'ENV'
TELEGRAM_BOT_TOKEN=123456789:AA...
DOT_TELEGRAM_ALLOWED_USERS=123456789
# On a server, point to the copied key:
# GENTLE_DOT_TOKEN_FILE=/home/you/.config/dot-telegram/token
ENV
chmod 600 .env
```

| Variable | Required | Default | Meaning |
| :--- | :---: | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | yes | | The token from BotFather |
| `DOT_TELEGRAM_ALLOWED_USERS` | yes | | Comma-separated numeric Telegram user ids allowed to use the bot |
| `GENTLE_DOT_URL` | no | `ws://127.0.0.1:4317/ws` | The daemon's WebSocket address |
| `GENTLE_DOT_TOKEN_FILE` | no | `~/.gentle-dot/token` | The file with the daemon's access key |

A missing or invalid value stops the bot with a message naming the variable. Token values are never printed.

### 5. Run

```sh
npm run start:env   # node --env-file=.env src/main.ts
```

You should see:

```text
[dot-telegram] connected to Gentle Dot
[dot-telegram] listening as @your_bot
```

Now write to your bot. `npm start` reads the same variables from the environment instead of `.env`.

### 6. Keep it running (optional)

On a server, a systemd service restarts the bot with the machine and after failures. Adjust the user and paths:

```ini
# /etc/systemd/system/dot-telegram.service
[Unit]
Description=dot-telegram (Telegram bridge for Gentle Dot)
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=you
WorkingDirectory=/home/you/dot-telegram
ExecStart=/usr/bin/node --env-file=.env src/main.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now dot-telegram
journalctl -u dot-telegram -f
```

To update: `git pull --ff-only && npm ci && sudo systemctl restart dot-telegram`.

### Update an existing Docker deployment

If your installation already provides a `Dockerfile` and `compose.yaml` with the `bridge` service and `dot-telegram:deploy` image, run the following in that directory. Keep its existing `.env`, network, and daemon-volume configuration. The commands replace only the Telegram bridge, not Gentle Dot; a short bot interruption is expected.

Save a rollback image, build only the required application files (never send `.env`, `.git`, or `node_modules` as build context), then recreate the service:

```bash
set -euo pipefail
previous=$(docker inspect "$(docker compose ps -q bridge)" --format '{{.Image}}')
rollback="dot-telegram:rollback-$(date -u +%Y%m%dT%H%M%SZ)"
docker tag "$previous" "$rollback"
printf 'Rollback image: %s\n' "$rollback"
tar -cf - Dockerfile package.json package-lock.json src tsconfig.json \
  | docker build --tag dot-telegram:deploy -
docker compose up -d --no-deps --no-build --pull never bridge
docker compose ps bridge
docker compose logs --tail=30 bridge
```

Expect `connected to Gentle Dot` and `listening as @your_bot`, without repeated restarts or polling conflicts. Then follow [Try it from Telegram](#try-it-from-telegram). Startup logs prove connectivity, not a model-selection round trip: perform that final check from your own chat.

If startup fails, restore the image saved in `$rollback` and recreate only the bridge:

```bash
docker tag "$rollback" dot-telegram:deploy
docker compose up -d --no-deps --no-build --pull never bridge
```

<div align="right"><a href="#top">Back to top</a></div>

<div align="center"><img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-dot/main/docs/assets/brand/rose.png" width="28" alt="" /></div>

## Security

What holds:

- **Only you, only in private.** Updates from user ids outside `DOT_TELEGRAM_ALLOWED_USERS`, and from every group or channel, are ignored without an answer and never reach Gentle Dot.
- **No more power than a browser window.** Gentle Dot refuses connector changes and approvals of sending actions from every window, this bot included. Telegram can only tell you where they wait: the desktop app, or the web page with your PIN on a server.
- **No secret in the logs.** Configuration errors name the variable, never its value, and failed downloads never show the address that carries the bot token.
- **Nothing exposed.** The bot polls Telegram from the inside out and talks to the daemon on the loopback address by default: no port is opened.

What to keep in mind:

- **Questions are answerable from Telegram**, as from the browser: whoever answers first wins. Your Telegram account becomes as sensitive as the Gentle Dot web page, so turn on Telegram's two-step verification.
- **Telegram sees the conversation.** Bot chats are not end-to-end encrypted: what the assistant says, including what it recalls from memory, passes through Telegram's servers.
- **Where the secrets live.** The bot token (`.env`) and the daemon's access key are files readable by your user. On the desktop, the assistant's shell runs as your user and can read them too. On a server, the assistant runs inside the container as its own user and cannot reach the copies on the host.
- **Treat the bot token as a password.** If it ever lands in a chat, a log, or a commit, send `/revoke` to @BotFather and update `.env`.

<div align="right"><a href="#top">Back to top</a></div>

<div align="center"><img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-dot/main/docs/assets/brand/rose.png" width="28" alt="" /></div>

## Troubleshooting

| What you see | What it means |
| :--- | :--- |
| `TELEGRAM_BOT_TOKEN is required` | `.env` was not read: run from the project folder, or check `WorkingDirectory` in the service |
| `Cannot read the Gentle Dot access key at …` | Wrong `GENTLE_DOT_TOKEN_FILE`, or the key was never copied (step 3) |
| `The daemon refused the access key` | The key changed: copy it again |
| `disconnected from Gentle Dot, retrying`, again and again | Gentle Dot is not running or not listening on `GENTLE_DOT_URL`; the bot reconnects on its own (1 s, doubling, at most 30 s) |
| Telegram answers `401 Unauthorized` | The token the bot uses is not the one BotFather gave you. Compare fingerprints without printing it: `sed -n 's/^TELEGRAM_BOT_TOKEN=//p' .env \| tr -d '\n' \| sha256sum`. Look for quotes, spaces, or a `\r` at the end of the line |
| Telegram answers `409 Conflict` | Two processes poll with the same token: stop one of them |
| The bot never answers | You are writing from another account, or from a group: it only answers in private to allowed ids |
| "Voice notes need an OpenAI API key" | Gentle Dot transcribes with OpenAI: connect an OpenAI API key in Gentle Dot |
| "No models are available" | Connect an AI account in Gentle Dot web first |
| "The model request could not be confirmed" | Run `/model` to check the actual state; no automatic retry was sent. If listing never responds, update Gentle Dot to a version supporting `models_list` / `model_set` (present at `535e7f7`) |

<div align="right"><a href="#top">Back to top</a></div>

<div align="center"><img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-dot/main/docs/assets/brand/rose.png" width="28" alt="" /></div>

## How it works

```text
Telegram  ⇄  dot-telegram (grammY, long polling)  ⇄  WebSocket  ⇄  Gentle Dot daemon  ⇄  assistant
```

The bot signs in with `hello` and the daemon's access key, then translates in both directions:

| Telegram | Gentle Dot protocol |
| :--- | :--- |
| A text message | `send` |
| `/stop`, the stop button | `abort` |
| `/model`, model-selection buttons | `models_list`, `model_set`; `models` reports current/pending state |
| A button, a typed reply, `/cancel` | `ui_response` |
| A voice note | `voice_transcribe`, then `send` with the transcript |
| A file, photo, video, or audio | `POST /upload` (HTTP, same address and access key), then `send` with `attachments` |
| Live status (`sendMessageDraft`) | `agent_state`, `activity` |
| The answer (`sendMessage`) | `message_done` |

| File | Role |
| :--- | :--- |
| [`src/main.ts`](src/main.ts) | Wiring, startup, and shutdown |
| [`src/config.ts`](src/config.ts) | Reads and checks the environment |
| [`src/daemon-client.ts`](src/daemon-client.ts) | The WebSocket connection: `hello`, reconnects, fatal close codes |
| [`src/bridge.ts`](src/bridge.ts) | Telegram updates to protocol messages and back |
| [`src/models.ts`](src/models.ts) | Paginated model menus, daemon-confirmed selection, and reconnect cleanup |
| [`src/uploads.ts`](src/uploads.ts) | Uploads files to the daemon's `POST /upload` |
| [`src/protocol.ts`](src/protocol.ts) | The part of Gentle Dot's protocol the bot uses, copied because that package is not published |

### Limits today

- Answers are sent as plain text, so Markdown shows as typed.
- One chat at a time: daemon events go to the allowed chat that wrote last.
- Files only go in, up to 20 MB each. The assistant cannot send you a file yet.
- A photo album arrives as one message per photo, each sent on its own.
- Live status needs a Telegram app recent enough for Bot API 10.3 drafts.

<div align="right"><a href="#top">Back to top</a></div>

<div align="center"><img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-dot/main/docs/assets/brand/rose.png" width="28" alt="" /></div>

## Development

```sh
npm test            # vitest: a fake daemon and a recorded Bot API, no network
npm run typecheck   # tsc --noEmit
```

The tests drive the public surface only: a real WebSocket server plays the daemon, and grammY's API transformer records every Bot API call instead of sending it.

<div align="right"><a href="#top">Back to top</a></div>

<div align="center"><img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-dot/main/docs/assets/brand/rose.png" width="28" alt="" /></div>

## Built with Gentle-AI

<div align="center">

<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="220" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>

</div>

dot-telegram was [built with Gentle-AI](https://github.com/Gentleman-Programming/gentle-ai#built-with-gentle-ai), for [Gentle Dot](https://github.com/Gentleman-Programming/gentle-dot).

## License

[MIT](LICENSE) © danielgap

<div align="right"><a href="#top">Back to top</a></div>
