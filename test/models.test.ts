import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerPayload } from "../src/protocol.ts";
import { harness, OWNER, STRANGER } from "./helpers.ts";

type H = ReturnType<typeof harness>;
// Wire fixture intentionally independent of the bridge's copied protocol subset.
const catalog = {
	type: "models",
	current: { provider: "a", id: "one", name: "One", thinking: "medium" },
	groups: [{ provider: "a", name: "Account A", models: [
		{ provider: "a", id: "one", name: "One", images: true, thinkingLevels: ["medium"] },
		{ provider: "b", id: "two", name: "Two", images: false, thinkingLevels: ["low", "medium"] },
		{ provider: "b", id: "fast", name: "Fast", images: false },
	] }],
	profiles: [],
};
const emit = (h: H, value = catalog) => h.daemonSays(value as unknown as ServerPayload);
const texts = (h: H) => h.of("sendMessage").map((c) => c.payload.text);
function buttons(h: H) {
	const sent = [...h.of("sendMessage"), ...h.of("editMessageText")].at(-1)!;
	return (sent.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.flat();
}
async function press(h: H, label: string, from = OWNER, messageId = 101, data?: string) {
	await h.update({ callback_query: {
		id: `cb-${Math.random()}`, from: { id: from, is_bot: false, first_name: "U" }, chat_instance: "ci",
		data: data ?? buttons(h).find((b) => b.text.includes(label))!.callback_data,
		message: { message_id: messageId, date: 0, chat: { id: from, type: "private", first_name: "U" }, text: "Models" },
	} } as never);
}
async function open(h = harness(), value = catalog) {
	await h.text("/model");
	await emit(h, value);
	return h;
}

afterEach(() => vi.useRealTimers());

describe("/model", () => {
	it("requests the daemon catalog without starting a turn and explains shared selection", async () => {
		const h = harness();
		await h.text("/model");
		expect(h.sent).toEqual([{ type: "models_list" }]);
		expect(h.of("sendMessageDraft")).toEqual([]);
		await emit(h);
		expect(texts(h)).toEqual(["Current model: One (a/one)\nThinking: medium\n\nShared with Gentle Dot web; saved as the default.\nChoose a model (page 1/1)."]);
		expect(buttons(h).map((b) => b.text)).toEqual(["✓ One · Account A", "Two · Account A", "Fast · Account A", "Close"]);
		const keyboard = h.of("sendMessage")[0]!.payload.reply_markup as { inline_keyboard: unknown[][] };
		expect(keyboard.inline_keyboard.every((row) => row.length > 0)).toBe(true);
	});

	it("only confirms a selection after matching daemon state and preserves supported thinking", async () => {
		const h = await open();
		await press(h, "Two");
		expect(h.sent).toEqual([{ type: "models_list" }, { type: "model_set", provider: "b", id: "two", thinking: "medium" }]);
		expect(texts(h)).toHaveLength(1);
		await emit(h);
		expect(texts(h)).toHaveLength(1);
		await emit(h, { ...catalog, current: { provider: "b", id: "two", name: "Two", thinking: "medium" } });
		expect(texts(h).at(-1)).toBe("Current model: Two (b/two)\nThinking: medium");
		await emit(h);
		expect(texts(h)).toHaveLength(2);
	});

	it("omits unsupported thinking and distinguishes deferred selection without aborting", async () => {
		const h = await open();
		await press(h, "Fast");
		expect(h.sent.at(-1)).toEqual({ type: "model_set", provider: "b", id: "fast" });
		await emit(h, { ...catalog, next: { provider: "b", id: "fast", name: "Fast" } } as typeof catalog);
		expect(texts(h).at(-1)).toBe("Pending model: Fast (b/fast). It will be used after the current reply finishes.");
		expect(h.sent.some((m) => m.type === "abort")).toBe(false);
	});

	it("paginates large catalogs with short callback payloads and no lost models", async () => {
		const models = Array.from({ length: 21 }, (_, i) => ({ provider: "p", id: `${i}-${"x".repeat(200)}`, name: `Model ${i}`, images: false }));
		const h = await open(harness(), { ...catalog, groups: [{ provider: "p", name: "Provider", models }] } as typeof catalog);
		expect(buttons(h).filter((b) => b.text.includes(" · "))).toHaveLength(8);
		for (const b of buttons(h)) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
		await press(h, "Next");
		expect(buttons(h)[0]!.text).toBe("Model 8 · Provider");
		await press(h, "Next");
		expect(buttons(h)[0]!.text).toBe("Model 16 · Provider");
		await press(h, "Model 20");
		expect(h.sent.at(-1)).toEqual({ type: "model_set", provider: "p", id: models[20]!.id });
	});

	it("updates open menus for external state without unsolicited or duplicate messages", async () => {
		const h = harness();
		await emit(h);
		expect(h.calls).toEqual([]);
		await open(h);
		await emit(h);
		expect(h.of("editMessageText")).toEqual([]);
		await emit(h, { ...catalog, current: { provider: "b", id: "two", name: "Two", thinking: "medium" } });
		expect(h.of("editMessageText")).toHaveLength(1);
		expect(h.of("editMessageText")[0]!.payload.text).toContain("Current model: Two");
		expect(texts(h)).toHaveLength(1);
	});

	it("rejects strangers, groups, another allowed chat, a different message and repeated callbacks", async () => {
		const h = await open(harness({ allowedUsers: new Set([OWNER, 43]) }));
		const data = buttons(h).find((b) => b.text.includes("Two"))!.callback_data;
		await h.text("/model", STRANGER);
		await h.text("/model", OWNER, "group");
		await press(h, "", STRANGER, 101, data);
		await press(h, "", 43, 101, data);
		await press(h, "", OWNER, 999, data);
		expect(h.sent).toEqual([{ type: "models_list" }]);
		await press(h, "", OWNER, 101, data);
		await press(h, "", OWNER, 101, data);
		expect(h.sent.filter((m) => m.type === "model_set")).toHaveLength(1);
	});

	it("serializes local requests and routes the catalog to its original requester", async () => {
		const h = harness({ allowedUsers: new Set([OWNER, 43]) });
		await h.text("/model");
		await h.text("/model", 43);
		expect(h.sent).toEqual([{ type: "models_list" }]);
		await emit(h);
		expect(h.of("sendMessage").at(-1)!.payload.chat_id).toBe(OWNER);
		await h.text("/model", 43);
		await emit(h);
		expect(h.of("sendMessage").at(-1)!.payload.chat_id).toBe(43);
	});

	it("reports model errors without a turn and does not end an existing conversation", async () => {
		const h = await open();
		await press(h, "Two");
		await h.daemonSays({ type: "error", code: "model_unavailable", message: "That model is not available." });
		expect(texts(h).at(-1)).toBe("⚠️ That model is not available.");
		await h.text("hi");
		await open(h);
		await press(h, "Two", OWNER, 103);
		await h.daemonSays({ type: "error", code: "model_switch_failed", message: "Could not switch." });
		await h.daemonSays({ type: "message_done", messageId: "m", text: "Answer." });
		expect(texts(h).slice(-2)).toEqual(["⚠️ Could not switch.", "Answer."]);
		await h.bridge.connectionLost();
	});

	it("clears state on disconnect and never replays a mutation", async () => {
		const h = await open();
		const data = buttons(h)[1]!.callback_data;
		await h.bridge.connectionLost();
		await press(h, "", OWNER, 101, data);
		await emit(h);
		expect(h.sent).toEqual([{ type: "models_list" }]);
		await open(h);
		await press(h, "Two", OWNER, 102);
		await h.bridge.connectionLost();
		await emit(h);
		expect(h.sent.filter((m) => m.type === "model_set")).toHaveLength(1);
		expect(texts(h).at(-1)).toContain("could not be confirmed");
	});

	it("times out without assuming success, retrying or accepting old buttons", async () => {
		vi.useFakeTimers();
		const h = await open();
		await press(h, "Two");
		await vi.advanceTimersByTimeAsync(15_000);
		expect(texts(h).at(-1)).toBe("The model request could not be confirmed. Use /model to check the current state; it was not retried.");
		expect(h.sent).toHaveLength(2);
		await h.text("/model");
		expect(h.sent.at(-1)).toEqual({ type: "models_list" });
		await h.bridge.connectionLost();
	});

	it("handles unreachable, empty and unsupported catalogs without starting a turn", async () => {
		const h = harness();
		h.daemon.connected = false;
		await h.text("/model");
		expect(texts(h)).toEqual(["Gentle Dot is not reachable right now. Is it running?"]);
		h.daemon.connected = true;
		await h.text("/model");
		await h.daemonSays({ type: "error", code: "unsupported", message: "Update Gentle Dot." });
		expect(texts(h).at(-1)).toBe("⚠️ Update Gentle Dot.");
		await h.text("/model");
		await emit(h, { ...catalog, groups: [] });
		expect(texts(h).at(-1)).toContain("No models are available. Connect an account in Gentle Dot web first.");
		expect(buttons(h).map((b) => b.text)).toEqual(["Close"]);
		expect(h.of("sendMessageDraft")).toEqual([]);
	});

	it("closes locally and leaves stop and pending assistant questions intact", async () => {
		const h = await open();
		const close = buttons(h).find((b) => b.text === "Close")!.callback_data;
		await h.daemonSays({ type: "ask", ask: { requestId: "q", method: "input", title: "Name?" } });
		await press(h, "", OWNER, 101, close);
		expect(h.of("editMessageReplyMarkup").at(-1)!.payload).toEqual({ chat_id: OWNER, message_id: 101 });
		await h.text("/stop");
		await h.text("/cancel");
		expect(h.sent.slice(-2)).toEqual([{ type: "abort" }, { type: "ui_response", requestId: "q", cancelled: true }]);
	});
});
