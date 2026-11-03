import { afterEach, expect, it, vi } from "vitest";
import type { ServerPayload } from "../src/protocol.ts";
import { harness, OWNER } from "./helpers.ts";

const state = {
	type: "models", current: { provider: "a", id: "one", name: "One" },
	groups: [{ provider: "a", name: "A", models: [{ provider: "a", id: "one", name: "One", images: false }] }],
} as const;
const emit = (h: ReturnType<typeof harness>) => h.daemonSays(state as unknown as ServerPayload);
afterEach(() => vi.useRealTimers());

it("does not resurrect a menu when its initial Telegram send completes after disconnect", async () => {
	const h = harness();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	h.bot.api.config.use(async (prev, method, payload, signal) => {
		if (method === "sendMessage") await gate;
		return prev(method, payload, signal);
	});
	await h.text("/model");
	const showing = emit(h);
	await Promise.resolve();
	await h.bridge.connectionLost();
	release();
	await showing;
	expect(h.of("editMessageReplyMarkup").at(-1)?.payload).toEqual({ chat_id: OWNER, message_id: 101 });
	expect(h.sent).toEqual([{ type: "models_list" }]);
});

it("removes buttons again when an in-flight menu edit finishes after disconnect", async () => {
	const h = harness();
	await h.text("/model");
	await emit(h);
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	h.bot.api.config.use(async (prev, method, payload, signal) => {
		if (method === "editMessageText") await gate;
		return prev(method, payload, signal);
	});
	const updating = h.daemonSays({ ...state, current: { provider: "a", id: "one", name: "Renamed" } } as unknown as ServerPayload);
	await Promise.resolve();
	await h.bridge.connectionLost();
	release();
	await updating;
	expect(h.calls.at(-1)).toEqual({ method: "editMessageReplyMarkup", payload: { chat_id: OWNER, message_id: 101 } });
});

it("expires an unanswered list request and ignores malformed catalogs", async () => {
	vi.useFakeTimers();
	const h = harness();
	await h.text("/model");
	await h.daemonSays({ type: "models", groups: "bad" } as never);
	await vi.advanceTimersByTimeAsync(15_000);
	expect(h.sent).toEqual([{ type: "models_list" }]);
	expect(h.of("sendMessage").map((c) => c.payload.text)).toEqual([
		"The model request could not be confirmed. Use /model to check the current state; it was not retried.",
	]);
	await emit(h);
	expect(h.of("sendMessage")).toHaveLength(1);
});

it("keeps a failed selection available for an explicit retry, without replay on its own", async () => {
	const h = harness();
	await h.text("/model");
	await emit(h);
	const markup = h.of("sendMessage")[0]!.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] };
	const press = () => h.update({ callback_query: {
		id: "c", data: markup.inline_keyboard[0]![0]!.callback_data,
		from: { id: OWNER, first_name: "U", is_bot: false }, chat_instance: "ci",
		message: { message_id: 101, date: 0, chat: { id: OWNER, type: "private", first_name: "U" }, text: "Models" },
	} } as never);
	h.daemon.connected = false;
	await press();
	expect(h.sent).toEqual([{ type: "models_list" }]);
	expect(h.of("answerCallbackQuery").at(-1)?.payload.text).toBe("Gentle Dot is not reachable right now. Is it running?");
	h.daemon.connected = true;
	await press();
	expect(h.sent.at(-1)).toEqual({ type: "model_set", provider: "a", id: "one" });
	await h.bridge.connectionLost();
});
