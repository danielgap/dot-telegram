# dot-telegram

Talk to your [Gentle Dot](https://github.com/Gentleman-Programming/gentle-dot) assistant from Telegram.

dot-telegram is an **opt-in, separate process**. It joins the Gentle Dot daemon as one more client,
like a browser window, and relays one private Telegram chat. Gentle Dot itself does not change:
if you do not run dot-telegram, nothing of it exists.

> **Prototype.** It works against Gentle Dot's client protocol v1 (gentle-dot `535e7f7`). Read
> [Security](#security) before you run it.

## What works from Telegram

| In Telegram | What happens |
| :--- | :--- |
| Write a message | The assistant gets it, in the same conversation as the desktop app. While it works, you see a live status ("Thinking…", "Checking my notes…") with a stop button |
| The stop button, or `/stop` | Stops what the assistant is doing |
| A voice note | Transcribed by Gentle Dot (needs an OpenAI API key connected there), shown back to you as "🎙️ …", then sent |
| A question with choices | Buttons: Allow / Decline, or one per option plus Cancel |
| A question that needs text | Your next message is the answer; `/cancel` cancels it |
| An action that sends or changes something in your accounts | You are told to approve it in the Gentle Dot desktop app. It cannot be approved from Telegram |
| `/start`, `/help` | A short explanation |

Answers are relayed only for messages you sent from Telegram; conversations you have at the desktop
stay there. Questions from the assistant are always relayed, because someone has to answer them.

## Setup

You need Node.js 22.18 or later and Gentle Dot running on the same machine (or reachable over the network).

1. **Create the bot.** In Telegram, talk to [@BotFather](https://t.me/BotFather), send `/newbot`, and
   keep the token it gives you.
2. **Find your user id.** Send any message to [@userinfobot](https://t.me/userinfobot); it answers with
   your numeric id.
3. **Open a chat with your bot** and press Start, so it is allowed to write to you.
4. **Configure it** in a `.env` file readable only by you, so the token stays out of your shell history:

   ```sh
   cat > .env <<'ENV'
   TELEGRAM_BOT_TOKEN=123456:ABC...
   DOT_TELEGRAM_ALLOWED_USERS=123456789
   ENV
   chmod 600 .env
   ```

5. **Install and run:**

   ```sh
   npm install
   npm run start:env   # node --env-file=.env src/main.ts
   ```

   `npm start` reads the same variables from the environment instead.

### Configuration

| Variable | Required | Default | Meaning |
| :--- | :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | yes | | The token from BotFather |
| `DOT_TELEGRAM_ALLOWED_USERS` | yes | | Comma-separated numeric Telegram user ids allowed to use the bot |
| `GENTLE_DOT_URL` | no | `ws://127.0.0.1:4317/ws` | The daemon's WebSocket address |
| `GENTLE_DOT_TOKEN_FILE` | no | `~/.gentle-dot/token` | The file with the daemon's access key |

A missing or invalid value stops the bot with a message naming the variable; token values are never printed.

The bot reconnects to Gentle Dot on its own (1 s, doubling, at most 30 s). It stops only when the
daemon refuses the access key or speaks another protocol version.

## Security

- **Only allowlisted users, only private chats.** Everyone else, and every group, is ignored without an answer.
- **Desktop approvals stay on the desktop.** Gentle Dot refuses connector changes and native approvals
  from any window, this bot included, so Telegram can only tell you that something is waiting there.
- **Questions are answerable from Telegram**, exactly as from the browser: whoever answers first wins.
  Your Telegram account is therefore as sensitive as the Gentle Dot web page.
- **Telegram sees the conversation.** Bot chats are not end-to-end encrypted; what the assistant says,
  including what it recalls from memory, passes through Telegram's servers.
- **Files the assistant's shell can read.** The bot token (in your environment) and the daemon's access
  key (`~/.gentle-dot/token`) are readable by any program running as you, the assistant's own shell
  included. This is acceptable for a prototype, not for a final design: there, the daemon should own the
  bot and keep its token in the app's secure store.

## How it works

```
Telegram  ⇄  dot-telegram (grammY, long polling)  ⇄  WebSocket  ⇄  Gentle Dot daemon  ⇄  assistant
```

- `src/daemon-client.ts`: the WebSocket connection (`hello` with the access key, reconnects).
- `src/bridge.ts`: Telegram updates to protocol messages and back. Live status uses the Bot API's
  `sendMessageDraft` (private chats, Bot API 10.3+); the final answer is a normal message, split at 4096 characters.
- `src/protocol.ts`: the part of Gentle Dot's protocol the bridge uses, copied because that package is not published.

Answers are sent as plain text, so Markdown shows as typed.

## Development

```sh
npm test          # vitest: a fake daemon and a recorded Bot API, no network
npm run typecheck
```
