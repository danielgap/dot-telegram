import { randomBytes } from "node:crypto";
import { type Bot, type Context, InlineKeyboard } from "grammy";
import type { ClientMessage, ModelChoice, ModelRef, ModelsState } from "./protocol.ts";

const PAGE_SIZE = 8;
const UNCONFIRMED = "The model request could not be confirmed. Use /model to check the current state; it was not retried.";
const UNREACHABLE = "Gentle Dot is not reachable right now. Is it running?";
const MODEL_ERRORS = new Set(["model_unavailable", "thinking_unavailable", "model_switch_failed"]);
const COMMAND_ERRORS = new Set(["unsupported", "bad_message", "agent_unavailable", "command_failed"]);

interface Menu {
	chatId: number;
	messageId?: number;
	token: string;
	page: number;
	state: ModelsState;
	/** Telegram edits for one message must retain daemon event order. */
	render: Promise<void>;
}

interface Request {
	chatId: number;
	target?: ModelRef;
	timer: NodeJS.Timeout;
}

function describe(model: ModelRef): string {
	return `${model.name} (${model.provider}/${model.id})`;
}

function sameModel(actual: ModelRef | undefined, expected: ModelRef): boolean {
	return actual?.provider === expected.provider && actual.id === expected.id &&
		(expected.thinking === undefined || actual.thinking === expected.thinking);
}

function choices(state: ModelsState): (ModelChoice & { account: string })[] {
	return state.groups.flatMap((group) => group.models.map((model) => ({ ...model, account: group.name })));
}

/** Separate from assistant asks: choosing a model must never answer an open question. */
export class ModelPicker {
	private readonly menus = new Map<number, Menu>();
	/** No request IDs exist in this protocol; allow only one local control request at a time. */
	private request: Request | undefined;

	private readonly bot: Bot;
	private readonly send: (message: ClientMessage) => boolean;
	private readonly log: (message: string) => void;

	constructor(bot: Bot, send: (message: ClientMessage) => boolean, log: (message: string) => void) {
		this.bot = bot;
		this.send = send;
		this.log = log;
	}

	async open(chatId: number): Promise<void> {
		if (this.request) {
			await this.reply(chatId, "A model request is already pending. Try /model again shortly.");
			return;
		}
		const old = this.menus.get(chatId);
		this.menus.delete(chatId);
		this.begin(chatId);
		if (!this.send({ type: "models_list" })) {
			this.finish();
			await this.reply(chatId, UNREACHABLE);
		}
		if (old) await this.removeButtons(old);
	}

	async receive(state: ModelsState): Promise<void> {
		// Ignore malformed frames rather than generating actionable buttons from them.
		if (!Array.isArray(state.groups) || !state.groups.every((g) =>
			typeof g?.name === "string" && Array.isArray(g.models) && g.models.every((m) =>
				typeof m?.provider === "string" && typeof m.id === "string" && typeof m.name === "string" &&
				(m.thinkingLevels === undefined || Array.isArray(m.thinkingLevels))))) return;
		const request = this.request;
		let confirmation: string | undefined;
		if (request?.target) {
			// A broadcast is not an acknowledgement unless it reports the requested state.
			if (sameModel(state.next, request.target)) {
				confirmation = `Pending model: ${describe(state.next!)}. It will be used after the current reply finishes.`;
			} else if (!state.next && sameModel(state.current, request.target)) {
				confirmation = this.currentText(state);
			}
			if (confirmation) this.finish();
		} else if (request) {
			this.finish();
			this.menus.set(request.chatId, {
				chatId: request.chatId, token: "", page: 0, state, render: Promise.resolve(),
			});
		}
		const updates: Promise<void>[] = [];
		for (const menu of this.menus.values()) {
			if (menu.messageId !== undefined && JSON.stringify(menu.state) === JSON.stringify(state)) continue;
			menu.state = state;
			updates.push(this.render(menu));
		}
		if (confirmation && request) updates.push(this.reply(request.chatId, confirmation));
		await Promise.all(updates);
	}

	/** Generic errors are ambiguous during a chat turn; leave its original error routing intact. */
	async error(code: string, message: string, hasTurn: boolean): Promise<boolean> {
		if (!this.request || !(MODEL_ERRORS.has(code) || (!hasTurn && COMMAND_ERRORS.has(code)))) return false;
		const request = this.finish()!;
		await this.reply(request.chatId, `⚠️ ${message}`);
		return true;
	}

	async button(ctx: Context): Promise<void> {
		const [_, token, action] = ctx.callbackQuery?.data?.split(":") ?? [];
		const menu = this.menus.get(ctx.chat?.id ?? 0);
		if (!menu || menu.token !== token || menu.messageId !== ctx.callbackQuery?.message?.message_id) {
			await ctx.answerCallbackQuery({ text: "This model menu has expired. Use /model again." });
			return;
		}
		if (action === "close") {
			this.menus.delete(menu.chatId);
			await ctx.answerCallbackQuery();
			await this.removeButtons(menu);
			return;
		}
		if (action === "next" || action === "prev") {
			const page = menu.page + (action === "next" ? 1 : -1);
			if (page >= 0 && page < Math.ceil(choices(menu.state).length / PAGE_SIZE)) menu.page = page;
			await ctx.answerCallbackQuery();
			await this.render(menu);
			return;
		}
		const index = Number(action);
		const model = /^\d+$/.test(action ?? "") ? choices(menu.state)[index] : undefined;
		if (!model || index < menu.page * PAGE_SIZE || index >= (menu.page + 1) * PAGE_SIZE) {
			await ctx.answerCallbackQuery({ text: "This model menu has expired. Use /model again." });
			return;
		}
		if (this.request) {
			await ctx.answerCallbackQuery({ text: "A model request is already pending. Try again shortly." });
			return;
		}
		const thinking = menu.state.current?.thinking;
		const target: ModelRef = { provider: model.provider, id: model.id, name: model.name };
		if (thinking !== undefined && model.thinkingLevels?.includes(thinking)) target.thinking = thinking;
		this.begin(menu.chatId, target);
		const { name: _name, ...selection } = target;
		if (!this.send({ type: "model_set", ...selection })) {
			this.finish();
			await ctx.answerCallbackQuery({ text: UNREACHABLE });
			return;
		}
		// Retire synchronously before any Telegram await, so a double tap cannot send twice.
		this.menus.delete(menu.chatId);
		await ctx.answerCallbackQuery({ text: "Selection sent; waiting for Gentle Dot." });
		await this.removeButtons(menu);
	}

	async connectionLost(): Promise<void> {
		const request = this.finish();
		const menus = [...this.menus.values()];
		this.menus.clear();
		await Promise.all(menus.map((menu) => this.removeButtons(menu)));
		if (request) await this.reply(request.chatId, UNCONFIRMED);
	}

	private begin(chatId: number, target?: ModelRef): void {
		const timer = setTimeout(() => {
			this.finish();
			void this.reply(chatId, UNCONFIRMED);
		}, 15_000);
		timer.unref();
		this.request = { chatId, target, timer };
	}

	private finish(): Request | undefined {
		const request = this.request;
		clearTimeout(request?.timer);
		this.request = undefined;
		return request;
	}

	private currentText(state: ModelsState): string {
		return state.current
			? `Current model: ${describe(state.current)}${state.current.thinking ? `\nThinking: ${state.current.thinking}` : ""}`
			: "Current model: not reported by Gentle Dot.";
	}

	private render(menu: Menu): Promise<void> {
		const state = menu.state;
		const models = choices(state);
		const pages = Math.max(1, Math.ceil(models.length / PAGE_SIZE));
		menu.page = Math.min(menu.page, pages - 1);
		const token = menu.token = randomBytes(8).toString("hex");
		const keyboard = new InlineKeyboard();
		models.slice(menu.page * PAGE_SIZE, (menu.page + 1) * PAGE_SIZE).forEach((model, offset) => {
			const prefix = state.current && sameModel(state.current, model) ? "✓ " : "";
			keyboard.text(`${prefix}${model.name} · ${model.account}`.slice(0, 100), `m:${token}:${menu.page * PAGE_SIZE + offset}`).row();
		});
		if (menu.page > 0) keyboard.text("Previous", `m:${token}:prev`);
		if (menu.page + 1 < pages) keyboard.text("Next", `m:${token}:next`);
		if (menu.page > 0 || menu.page + 1 < pages) keyboard.row();
		keyboard.text("Close", `m:${token}:close`);
		const pending = state.next ? `\nPending model: ${describe(state.next)} (after the current reply).` : "";
		const footer = models.length ? `Choose a model (page ${menu.page + 1}/${pages}).`
			: "No models are available. Connect an account in Gentle Dot web first.";
		const text = `${this.currentText(state)}${pending}\n\nShared with Gentle Dot web; saved as the default.\n${footer}`;
		menu.render = menu.render.then(async () => {
			if (this.menus.get(menu.chatId) !== menu || token !== menu.token) return;
			try {
				if (menu.messageId === undefined) {
					const sent = await this.bot.api.sendMessage(menu.chatId, text.slice(0, 4096), { reply_markup: keyboard });
					menu.messageId = sent.message_id;
				} else {
					await this.bot.api.editMessageText(menu.chatId, menu.messageId, text.slice(0, 4096), { reply_markup: keyboard });
				}
				if (this.menus.get(menu.chatId) !== menu) await this.removeButtons(menu);
			} catch (error) {
				if (this.menus.get(menu.chatId) === menu) this.menus.delete(menu.chatId);
				this.log(`showing model menu failed: ${(error as Error).message}`);
			}
		});
		return menu.render;
	}

	private async removeButtons(menu: Menu): Promise<void> {
		if (menu.messageId === undefined) return;
		try {
			await this.bot.api.editMessageReplyMarkup(menu.chatId, menu.messageId);
		} catch (error) {
			this.log(`removing model buttons failed: ${(error as Error).message}`);
		}
	}

	private async reply(chatId: number, text: string): Promise<void> {
		try {
			await this.bot.api.sendMessage(chatId, text.slice(0, 4096));
		} catch (error) {
			this.log(`model response failed: ${(error as Error).message}`);
		}
	}
}
