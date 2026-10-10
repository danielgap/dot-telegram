import { describe, expect, it } from "vitest";
import type { Ask } from "../src/protocol.ts";
import { harness, OWNER, STRANGER } from "./helpers.ts";

type H = ReturnType<typeof harness>;

const confirm: Ask = { requestId: "req-1", method: "confirm", title: "Allow Notion to create pages?", message: "Title: Notes" };

function buttons(h: H, index = 0) {
	const markup = h.of("sendMessage")[index]?.payload.reply_markup as
		| { inline_keyboard: { text: string; callback_data: string }[][] }
		| undefined;
	return markup?.inline_keyboard.flat() ?? [];
}

async function press(h: H, data: string, from = OWNER) {
	const sent = h.of("sendMessage").at(-1);
	await h.update({
		callback_query: {
			id: `cb-${data}`,
			from: { id: from, is_bot: false, first_name: "U" },
			chat_instance: "ci",
			data,
			message: { message_id: 101, date: 0, chat: { id: from, type: "private", first_name: "U" }, text: String(sent?.payload.text) },
		},
	} as never);
}

describe("asks (S9)", () => {
	it("shows a confirm with Allow and Decline and answers it", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: confirm });
		const [message] = h.of("sendMessage");
		expect(message?.payload.chat_id).toBe(OWNER);
		expect(message?.payload.text).toBe("Allow Notion to create pages?\n\nTitle: Notes");
		expect(buttons(h).map((b) => b.text)).toEqual(["Allow", "Decline"]);
		await press(h, buttons(h)[0]!.callback_data);
		expect(h.sent).toEqual([{ type: "ui_response", requestId: "req-1", confirmed: true }]);
		expect(h.of("editMessageReplyMarkup")).toHaveLength(1);
		expect(h.of("answerCallbackQuery")).toHaveLength(1);
	});

	it("declines a confirm", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: confirm });
		await press(h, buttons(h)[1]!.callback_data);
		expect(h.sent).toEqual([{ type: "ui_response", requestId: "req-1", confirmed: false }]);
	});

	it("offers one button per option for a select, plus Cancel", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { requestId: "req-2", method: "select", title: "Which model?", options: ["Fast", "Smart"] } });
		expect(buttons(h).map((b) => b.text)).toEqual(["Fast", "Smart", "Cancel"]);
		await press(h, buttons(h)[1]!.callback_data);
		await h.daemonSays({ type: "ask", ask: { requestId: "req-3", method: "select", title: "Again?", options: ["Yes"] } });
		await press(h, buttons(h, 1)[1]!.callback_data);
		expect(h.sent).toEqual([
			{ type: "ui_response", requestId: "req-2", value: "Smart" },
			{ type: "ui_response", requestId: "req-3", cancelled: true },
		]);
	});

	it("keeps callback data within Telegram's 64 bytes for long request ids", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { ...confirm, requestId: "r".repeat(300) } });
		for (const button of buttons(h)) expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
	});

	it("takes the next text message as the answer to an input", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { requestId: "req-4", method: "input", title: "Name of the page?" } });
		expect(h.of("sendMessage")[0]?.payload.text).toBe("Name of the page?\n\nReply with your answer, or /cancel.");
		await h.text("Weekly notes");
		await h.text("now a normal message");
		expect(h.sent).toEqual([
			{ type: "ui_response", requestId: "req-4", value: "Weekly notes" },
			{ type: "send", text: "now a normal message" },
		]);
	});

	it("/cancel cancels a pending input, and says so when nothing is pending", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { requestId: "req-5", method: "editor", title: "Edit the draft" } });
		await h.text("/cancel");
		await h.text("/cancel");
		expect(h.sent).toEqual([{ type: "ui_response", requestId: "req-5", cancelled: true }]);
		expect(h.of("sendMessage").at(-1)?.payload.text).toBe("Nothing to cancel.");
	});

	it("points app approvals to the desktop, without buttons", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { requestId: "req-6", method: "app", title: "Send the email?" } });
		const [message] = h.of("sendMessage");
		expect(message?.payload.text).toBe("Send the email?\n\nApprove this in the Gentle Dot desktop app.");
		expect(message?.payload.reply_markup).toBeUndefined();
	});

	it("says PIN approvals are not supported here, without buttons", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { requestId: "req-7", method: "pin", title: "Send the email?" } });
		const [message] = h.of("sendMessage");
		expect(message?.payload.text).toBe(
			"Send the email?\n\nPIN approvals are not supported from Telegram. Use the Gentle Dot web page.",
		);
		expect(message?.payload.reply_markup).toBeUndefined();
	});

	it("removes the buttons when the ask is resolved elsewhere, and a late press changes nothing", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: confirm });
		const data = buttons(h)[0]!.callback_data;
		await h.daemonSays({ type: "ask_resolved", requestId: "req-1" });
		expect(h.of("editMessageReplyMarkup").map((c) => c.payload)).toEqual([{ chat_id: OWNER, message_id: 101 }]);
		await press(h, data);
		expect(h.sent).toEqual([]);
		expect(h.of("answerCallbackQuery").map((c) => c.payload.text)).toEqual(["This request is no longer pending."]);
	});

	it("ends a pending input when it is resolved elsewhere", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { requestId: "req-8", method: "input", title: "Name?" } });
		await h.daemonSays({ type: "ask_resolved", requestId: "req-8" });
		await h.text("hello");
		expect(h.sent).toEqual([{ type: "send", text: "hello" }]);
	});

	it("ignores a stranger pressing a button", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: confirm });
		await press(h, buttons(h)[0]!.callback_data, STRANGER);
		expect(h.sent).toEqual([]);
		expect(h.of("answerCallbackQuery")).toEqual([]);
	});

	it("keeps the ask pending when the daemon is unreachable", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: confirm });
		const data = buttons(h)[0]!.callback_data;
		h.daemon.connected = false;
		await press(h, data);
		expect(h.of("answerCallbackQuery").map((c) => c.payload.text)).toEqual([
			"Gentle Dot is not reachable right now. Is it running?",
		]);
		h.daemon.connected = true;
		await press(h, data);
		expect(h.sent).toEqual([{ type: "ui_response", requestId: "req-1", confirmed: true }]);
	});
});
