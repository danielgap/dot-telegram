import { describe, expect, it } from "vitest";
import { splitMessage } from "../src/bridge.ts";
import { harness, OWNER, STRANGER } from "./helpers.ts";

describe("allowlist (S3)", () => {
	it("ignores a user outside the allowlist: no reply, nothing to the daemon", async () => {
		const h = harness();
		await h.text("hello", STRANGER);
		await h.text("/stop", STRANGER);
		expect(h.calls).toEqual([]);
		expect(h.sent).toEqual([]);
	});

	it("ignores an allowed user writing from a group", async () => {
		const h = harness();
		await h.text("hello", OWNER, "group");
		expect(h.calls).toEqual([]);
		expect(h.sent).toEqual([]);
	});
});

describe("text and commands (S5)", () => {
	it("sends plain text to the daemon", async () => {
		const h = harness();
		await h.text("what's on today?");
		expect(h.sent).toEqual([{ type: "send", text: "what's on today?" }]);
	});

	it("says so when the daemon is not reachable", async () => {
		const h = harness();
		h.daemon.connected = false;
		await h.text("hi");
		expect(h.of("sendMessage").map((c) => c.payload.text)).toEqual([
			"Gentle Dot is not reachable right now. Is it running?",
		]);
	});

	it.each(["/start", "/help"])("%s explains how to use the bot without contacting the daemon", async (command) => {
		const h = harness();
		await h.text(command);
		expect(h.sent).toEqual([]);
		const [reply] = h.of("sendMessage");
		expect(reply?.payload.chat_id).toBe(OWNER);
		expect(reply?.payload.text).toContain("/stop");
	});

	it("/stop sends abort", async () => {
		const h = harness();
		await h.text("/stop");
		expect(h.sent).toEqual([{ type: "abort" }]);
	});

	it("does not forward other slash commands", async () => {
		const h = harness();
		await h.text("/login");
		expect(h.sent).toEqual([]);
		expect(h.of("sendMessage").map((c) => c.payload.text)).toEqual(["That command is not supported here."]);
	});
});

describe("hybrid drafts (S6)", () => {
	it("shows Thinking…, then activity titles, then the final text as a message", async () => {
		const h = harness();
		await h.text("check my notes");
		await h.daemonSays({ type: "agent_state", state: "thinking" });
		await h.daemonSays({
			type: "activity",
			messageId: "m1",
			activity: { id: "a1", kind: "memory", title: "Checking my notes", status: "running" },
		});
		await h.daemonSays({ type: "message_delta", messageId: "m1", delta: "raw Gentle Shell text" });
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "You have two meetings." });

		const drafts = h.of("sendMessageDraft").map((c) => c.payload);
		expect(drafts[0]).toMatchObject({ chat_id: OWNER, text: "", can_stop: true });
		expect(drafts[1]).toMatchObject({ chat_id: OWNER, text: "Checking my notes…", can_stop: true });
		expect(new Set(drafts.map((d) => d.draft_id)).size).toBe(1);
		expect(drafts[0]?.draft_id).not.toBe(0);
		expect(drafts.some((d) => String(d.text).includes("raw"))).toBe(false);
		expect(h.of("sendMessage").map((c) => c.payload)).toEqual([
			{ chat_id: OWNER, text: "You have two meetings." },
		]);
	});

	it("sends a failed answer's explanation", async () => {
		const h = harness();
		await h.text("hi");
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "", error: "The model is unavailable." });
		expect(h.of("sendMessage").map((c) => c.payload.text)).toEqual(["The model is unavailable."]);
	});

	it("splits a long answer into Telegram-sized messages", async () => {
		const h = harness();
		await h.text("long please");
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "x".repeat(9000) });
		const texts = h.of("sendMessage").map((c) => String(c.payload.text));
		expect(texts.map((t) => t.length)).toEqual([4096, 4096, 808]);
	});

	it("refreshes the draft before Telegram's 30 s preview ends", async () => {
		const h = harness({ draftRefreshMs: 20 });
		await h.text("slow task");
		await h.daemonSays({ type: "agent_state", state: "working" });
		const before = h.of("sendMessageDraft").length;
		await new Promise((resolve) => setTimeout(resolve, 70));
		expect(h.of("sendMessageDraft").length).toBeGreaterThan(before);
		await h.daemonSays({ type: "agent_state", state: "idle" });
		const after = h.of("sendMessageDraft").length;
		await new Promise((resolve) => setTimeout(resolve, 70));
		expect(h.of("sendMessageDraft").length).toBe(after);
	});

	it("keeps working when Telegram rejects a draft", async () => {
		const h = harness();
		h.failing.add("sendMessageDraft");
		await h.text("hi");
		await h.daemonSays({ type: "agent_state", state: "thinking" });
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "Done." });
		expect(h.of("sendMessage").map((c) => c.payload.text)).toEqual(["Done."]);
	});
});

describe("connection loss during a turn (S4, S6)", () => {
	it("tells the chat, ends the turn and stops refreshing the draft", async () => {
		const h = harness({ draftRefreshMs: 20 });
		await h.text("hi");
		await h.bridge.connectionLost();
		const drafts = h.of("sendMessageDraft").length;
		await new Promise((resolve) => setTimeout(resolve, 70));
		expect(h.of("sendMessageDraft").length).toBe(drafts);
		expect(h.of("sendMessage").map((c) => c.payload.text)).toEqual([
			"Lost the connection to Gentle Dot. It will reconnect on its own; send your message again then.",
		]);
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "late" });
		expect(h.of("sendMessage")).toHaveLength(1);
	});

	it("says nothing when no Telegram turn is active", async () => {
		const h = harness();
		await h.bridge.connectionLost();
		expect(h.calls).toEqual([]);
	});
});

describe("stop button (S7)", () => {
	it("aborts when the user stops the active draft", async () => {
		const h = harness();
		await h.text("long task");
		const draftId = h.of("sendMessageDraft")[0]?.payload.draft_id as number;
		await h.update({
			stopped_message_generation: { chat: { id: OWNER, type: "private", first_name: "U" }, draft_id: draftId },
		} as never);
		expect(h.sent).toEqual([{ type: "send", text: "long task" }, { type: "abort" }]);
	});

	it("ignores a stop for a draft that is not active", async () => {
		const h = harness();
		await h.text("task");
		await h.update({
			stopped_message_generation: { chat: { id: OWNER, type: "private", first_name: "U" }, draft_id: 999_999 },
		} as never);
		expect(h.sent).toEqual([{ type: "send", text: "task" }]);
	});
});

describe("turn scope (S8)", () => {
	it("does not relay answers to turns started elsewhere", async () => {
		const h = harness();
		await h.daemonSays({ type: "agent_state", state: "thinking" });
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "desktop answer" });
		await h.daemonSays({ type: "toast", level: "error", message: "desktop toast" });
		expect(h.calls).toEqual([]);
	});

	it("ends the Telegram turn when the assistant goes idle", async () => {
		const h = harness();
		await h.text("hi");
		await h.daemonSays({ type: "agent_state", state: "thinking" });
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "Hello." });
		await h.daemonSays({ type: "agent_state", state: "idle" });
		await h.daemonSays({ type: "agent_state", state: "thinking" });
		await h.daemonSays({ type: "message_done", messageId: "m2", text: "desktop answer" });
		expect(h.of("sendMessage").map((c) => c.payload.text)).toEqual(["Hello."]);
	});

	it("relays warnings, errors and daemon errors during a Telegram turn, but not info toasts", async () => {
		const h = harness();
		await h.text("hi");
		await h.daemonSays({ type: "toast", level: "info", message: "fyi" });
		await h.daemonSays({ type: "toast", level: "warning", message: "Careful." });
		await h.daemonSays({ type: "error", code: "no_account", message: "Connect an AI account first." });
		expect(h.of("sendMessage").map((c) => c.payload.text)).toEqual(["⚠️ Careful.", "⚠️ Connect an AI account first."]);
	});
});

describe("splitMessage", () => {
	it("prefers a line break inside the limit", () => {
		const text = `${"a".repeat(10)}\n${"b".repeat(10)}`;
		expect(splitMessage(text, 15)).toEqual(["a".repeat(10), "b".repeat(10)]);
	});

	it("leaves short text alone and drops empty text", () => {
		expect(splitMessage("hi", 15)).toEqual(["hi"]);
		expect(splitMessage("", 15)).toEqual([]);
	});
});
