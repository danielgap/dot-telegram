import type { Bot, Context } from "grammy";
import type { AgentState, ClientMessage, ServerMessage } from "./protocol.ts";

/** Telegram's longest text message. */
export const TELEGRAM_TEXT_LIMIT = 4096;

/** Telegram keeps a draft for 30 s; refresh it well before that. */
const DRAFT_REFRESH_MS = 20_000;

const BUSY_STATES: AgentState[] = ["thinking", "working", "needs_you"];

const HELP = [
	"I relay this chat to your Gentle Dot assistant.",
	"",
	"Write a message to talk to it. /stop stops what it is doing; the stop button on its live status does the same.",
	"Actions that send or change something in your accounts are approved in the Gentle Dot desktop app.",
].join("\n");

export interface DaemonConnection {
	/** False when the message could not be sent (no connection). */
	send(message: ClientMessage): boolean;
}

export interface BridgeOptions {
	bot: Bot;
	daemon: DaemonConnection;
	allowedUsers: Set<number>;
	log(message: string): void;
	draftRefreshMs?: number;
}

/** Splits text into chunks of at most `limit` characters, at a line break when one is close. */
export function splitMessage(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
	const chunks: string[] = [];
	let rest = text;
	while (rest.length > limit) {
		const breakAt = rest.lastIndexOf("\n", limit);
		const cut = breakAt > limit / 2 ? breakAt : limit;
		chunks.push(rest.slice(0, cut));
		rest = rest.slice(cut).replace(/^\n/, "");
	}
	if (rest !== "") chunks.push(rest);
	return chunks;
}

interface Turn {
	chatId: number;
	draftId: number;
	draftText: string;
	/** The assistant was seen busy since this turn started, so the next idle ends it. */
	sawBusy: boolean;
	refresh: NodeJS.Timeout;
}

/** Relays one private Telegram chat to the Gentle Dot daemon and back. */
export class Bridge {
	private readonly options: BridgeOptions;
	private readonly bot: Bot;
	/** Where daemon events go: the allowed chat that wrote last. */
	private chatId: number;
	private turn: Turn | undefined;

	constructor(options: BridgeOptions) {
		this.options = options;
		this.bot = options.bot;
		this.chatId = [...options.allowedUsers][0] ?? 0;
		this.bot.use((ctx, next) => (this.allowed(ctx) ? next() : undefined));
		this.bot.command(["start", "help"], (ctx) => this.reply(ctx.chat.id, HELP));
		this.bot.command("stop", (ctx) => this.stop(ctx.chat.id));
		this.bot.on("message:text", (ctx) => this.onText(ctx.chat.id, ctx.message.text));
		this.bot.on("stopped_message_generation", (ctx) => {
			const stopped = ctx.update.stopped_message_generation;
			if (stopped && this.turn?.draftId === stopped.draft_id) this.options.daemon.send({ type: "abort" });
		});
		this.bot.catch((error) => this.options.log(`telegram update failed: ${(error.error as Error).message}`));
	}

	/** Handles one daemon message; resolves once its Telegram calls are done. */
	async handleDaemon(message: ServerMessage): Promise<void> {
		const turn = this.turn;
		switch (message.type) {
			case "agent_state":
				if (!turn) return;
				if (BUSY_STATES.includes(message.state)) {
					turn.sawBusy = true;
				} else if (turn.sawBusy && (message.state === "idle" || message.state === "error")) {
					this.endTurn();
				}
				return;
			case "activity":
				if (!turn || message.activity.status !== "running") return;
				turn.draftText = `${message.activity.title}…`;
				await this.draft(turn);
				return;
			case "message_done": {
				if (!turn) return;
				const text = message.error ?? message.text;
				for (const chunk of splitMessage(text)) await this.reply(turn.chatId, chunk);
				return;
			}
			case "toast":
				if (turn && message.level !== "info") await this.reply(turn.chatId, `⚠️ ${message.message}`);
				return;
			case "error":
				if (turn) await this.reply(turn.chatId, `⚠️ ${message.message}`);
				return;
			default:
				return;
		}
	}

	/** The daemon connection dropped: a Telegram turn cannot finish, so it ends here. */
	async connectionLost(): Promise<void> {
		const turn = this.turn;
		if (!turn) return;
		this.endTurn();
		await this.reply(
			turn.chatId,
			"Lost the connection to Gentle Dot. It will reconnect on its own; send your message again then.",
		);
	}

	private allowed(ctx: Context): boolean {
		const chat = ctx.chat;
		if (chat?.type !== "private" || !this.options.allowedUsers.has(chat.id)) return false;
		if (ctx.from && !this.options.allowedUsers.has(ctx.from.id)) return false;
		this.chatId = chat.id;
		return true;
	}

	private async onText(chatId: number, text: string): Promise<void> {
		if (text.startsWith("/")) {
			await this.reply(chatId, "That command is not supported here.");
			return;
		}
		await this.sendToAssistant(chatId, text);
	}

	private async sendToAssistant(chatId: number, text: string): Promise<void> {
		if (!this.options.daemon.send({ type: "send", text })) {
			await this.reply(chatId, "Gentle Dot is not reachable right now. Is it running?");
			return;
		}
		if (this.turn) return;
		const turn: Turn = {
			chatId,
			draftId: 1 + Math.floor(Math.random() * 2_000_000_000),
			draftText: "",
			sawBusy: false,
			refresh: setInterval(() => void this.draft(turn), this.options.draftRefreshMs ?? DRAFT_REFRESH_MS),
		};
		this.turn = turn;
		await this.draft(turn);
	}

	private async stop(chatId: number): Promise<void> {
		if (!this.options.daemon.send({ type: "abort" })) {
			await this.reply(chatId, "Gentle Dot is not reachable right now. Is it running?");
		}
	}

	private endTurn(): void {
		if (!this.turn) return;
		clearInterval(this.turn.refresh);
		this.turn = undefined;
	}

	private async draft(turn: Turn): Promise<void> {
		if (this.turn !== turn) return;
		try {
			await this.bot.api.sendMessageDraft(turn.chatId, turn.draftId, turn.draftText, { can_stop: true });
		} catch (error) {
			this.options.log(`draft failed: ${(error as Error).message}`);
		}
	}

	private async reply(chatId: number, text: string): Promise<void> {
		try {
			await this.bot.api.sendMessage(chatId, text);
		} catch (error) {
			this.options.log(`sending a message failed: ${(error as Error).message}`);
		}
	}
}
