import { describe, expect, it } from "vitest";
import { telegramDownloader } from "../src/bridge.ts";
import type { ServerMessage } from "../src/protocol.ts";
import { harness, OWNER } from "./helpers.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const texts = (h: ReturnType<typeof harness>) => h.of("sendMessage").map((c) => c.payload.text);

describe("turn end (S6, S8)", () => {
	it("ends a turn steered into a run that was already busy when the assistant goes idle", async () => {
		const h = harness({ draftRefreshMs: 20 });
		await h.daemonSays({ type: "ready", agentState: "working" });
		await h.text("also check the calendar");
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "Both done." });
		await h.daemonSays({ type: "agent_state", state: "idle" });
		await h.daemonSays({ type: "agent_state", state: "thinking" });
		await h.daemonSays({ type: "message_done", messageId: "m2", text: "desktop answer" });
		const drafts = h.of("sendMessageDraft").length;
		await wait(70);
		expect(h.of("sendMessageDraft").length).toBe(drafts);
		expect(texts(h)).toEqual(["Both done."]);
	});

	it("ends the turn when the daemon rejects the message while the assistant is idle", async () => {
		const h = harness({ draftRefreshMs: 20 });
		await h.daemonSays({ type: "ready", agentState: "idle" });
		await h.text("hi");
		await h.daemonSays({ type: "error", code: "no_account", message: "Connect an AI account first." });
		const drafts = h.of("sendMessageDraft").length;
		await wait(70);
		expect(h.of("sendMessageDraft").length).toBe(drafts);
		await h.daemonSays({ type: "agent_state", state: "thinking" });
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "desktop answer" });
		expect(texts(h)).toEqual(["⚠️ Connect an AI account first."]);
	});

	it("keeps the turn when an error arrives while the assistant is busy", async () => {
		const h = harness();
		await h.text("hi");
		await h.daemonSays({ type: "agent_state", state: "working" });
		await h.daemonSays({ type: "error", code: "command_failed", message: "That did not work." });
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "Answer." });
		expect(texts(h)).toEqual(["⚠️ That did not work.", "Answer."]);
	});
});

describe("connection loss clears pending state (S4, S9, S10)", () => {
	it("drops pending questions and their buttons, so the next message goes to the assistant", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { requestId: "r1", method: "confirm", title: "Allow?" } });
		await h.daemonSays({ type: "ask", ask: { requestId: "r2", method: "input", title: "Name?" } });
		await h.bridge.connectionLost();
		expect(h.of("editMessageReplyMarkup").map((c) => c.payload)).toEqual([{ chat_id: OWNER, message_id: 101 }]);
		await h.text("hello again");
		expect(h.sent).toEqual([{ type: "send", text: "hello again" }]);
	});

	it("forgets transcriptions in flight", async () => {
		const h = harness({ download: async () => Buffer.from("ogg") });
		await h.daemonSays({ type: "ready", agentState: "idle", voice: { transcribe: true, speak: false } });
		await h.voice();
		const requestId = (h.sent[0] as { requestId: string }).requestId;
		await h.bridge.connectionLost();
		await h.daemonSays({ type: "voice_transcript", requestId, text: "late" });
		expect(h.sent).toHaveLength(1);
	});

	it("shows a question only once when the daemon sends it again", async () => {
		const h = harness();
		const ask = { requestId: "r1", method: "confirm" as const, title: "Allow?" };
		await h.daemonSays({ type: "ask", ask });
		await h.daemonSays({ type: "ask", ask });
		expect(h.of("sendMessage")).toHaveLength(1);
	});
});

describe("defensive handling", () => {
	it.each([
		{ type: "activity", seq: 1 },
		{ type: "message_done", messageId: "m1", seq: 1 },
		{ type: "ask", seq: 1 },
		{ type: "ask", ask: { requestId: 5, method: "confirm" }, seq: 1 },
		{ type: "voice_transcript", requestId: "x", seq: 1 },
	])("survives a malformed daemon message %j", async (message) => {
		const h = harness();
		await h.text("hi");
		await expect(h.bridge.handleDaemon(message as unknown as ServerMessage)).resolves.toBeUndefined();
	});

	it("does not forward a slash command typed after spaces", async () => {
		const h = harness();
		await h.text("  /login");
		expect(h.sent).toEqual([]);
		expect(texts(h)).toEqual(["That command is not supported here."]);
	});

	it("says Stopped. for an empty stopped answer and sends nothing for a blank one", async () => {
		const h = harness();
		await h.text("hi");
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "  \n", stopped: true });
		await h.daemonSays({ type: "message_done", messageId: "m2", text: " \n " });
		expect(texts(h)).toEqual(["Stopped."]);
	});

	it("forgets the voice capability when a later ready does not offer it", async () => {
		const h = harness({ download: async () => Buffer.from("ogg") });
		await h.daemonSays({ type: "ready", agentState: "idle", voice: { transcribe: true, speak: false } });
		await h.daemonSays({ type: "ready", agentState: "idle" });
		await h.voice();
		expect(h.sent).toEqual([]);
		expect(texts(h)).toEqual(["Voice notes need an OpenAI API key connected in Gentle Dot."]);
	});

	it("shortens a question too long for one Telegram message", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { requestId: "r1", method: "confirm", title: "Allow?", message: "x".repeat(6000) } });
		const text = String(h.of("sendMessage")[0]?.payload.text);
		expect(text.length).toBeLessThanOrEqual(4096);
		expect(text.endsWith("…")).toBe(true);
	});
});

describe("telegramDownloader", () => {
	it("gives up after its timeout without naming the address", async () => {
		const hang: typeof fetch = (_url, init) =>
			new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error(`aborted ${String(_url)}`))));
		const download = telegramDownloader("123:secret", { timeoutMs: 20, fetch: hang });
		await expect(download("voice/file.oga")).rejects.toThrow("timed out");
		await expect(download("voice/file.oga")).rejects.not.toThrow("secret");
	});

	it("reports an HTTP failure by status only", async () => {
		const notFound: typeof fetch = async () => new Response("no", { status: 404 });
		const download = telegramDownloader("123:secret", { fetch: notFound });
		await expect(download("voice/file.oga")).rejects.toThrow(/^HTTP 404$/);
	});
});

describe("second verification round", () => {
	it("keeps the turn when an unrelated error arrives before the run starts", async () => {
		const h = harness();
		await h.daemonSays({ type: "ready", agentState: "idle" });
		await h.text("hi");
		await h.daemonSays({ type: "error", code: "ask_not_found", message: "That question is no longer open." });
		await h.daemonSays({ type: "agent_state", state: "thinking" });
		await h.daemonSays({ type: "message_done", messageId: "m1", text: "Hello." });
		expect(texts(h)).toEqual(["⚠️ That question is no longer open.", "Hello."]);
	});

	it("ends the turn before touching Telegram when the connection is lost", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { requestId: "r1", method: "confirm", title: "Allow?" } });
		await h.text("hi");
		const lost = h.bridge.connectionLost();
		await h.text("again");
		await lost;
		await h.daemonSays({ type: "message_done", messageId: "m2", text: "Answer to again." });
		expect(texts(h)).toContain("Answer to again.");
	});

	it("cancels an earlier input question when a new one replaces it", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { requestId: "r1", method: "input", title: "First?" } });
		await h.daemonSays({ type: "ask", ask: { requestId: "r2", method: "input", title: "Second?" } });
		await h.text("answer");
		expect(h.sent).toEqual([
			{ type: "ui_response", requestId: "r1", cancelled: true },
			{ type: "ui_response", requestId: "r2", value: "answer" },
		]);
	});

	it("sends a question with too many choices to the app instead of leaving it unseen", async () => {
		const h = harness();
		const options = Array.from({ length: 120 }, (_, i) => `Option ${i}`);
		await h.daemonSays({ type: "ask", ask: { requestId: "r1", method: "select", title: "Pick one", options } });
		const [message] = h.of("sendMessage");
		expect(message?.payload.text).toBe("Pick one\n\nToo many choices for Telegram; answer it in the Gentle Dot app or web page.");
		expect(message?.payload.reply_markup).toBeUndefined();
	});

	it("does not keep a question whose options are malformed", async () => {
		const h = harness();
		await h.daemonSays({ type: "ask", ask: { requestId: "r1", method: "select", title: "Pick", options: "nope" } } as never);
		await h.daemonSays({ type: "ask", ask: { requestId: "r1", method: "confirm", title: "Allow?" } });
		expect(h.of("sendMessage").map((c) => c.payload.text)).toEqual(["Allow?"]);
	});

	it("does not forget a question when Telegram refuses to show it", async () => {
		const h = harness();
		h.failing.add("sendMessage");
		await h.daemonSays({ type: "ask", ask: { requestId: "r1", method: "confirm", title: "Allow?" } });
		h.failing.delete("sendMessage");
		await h.daemonSays({ type: "ask", ask: { requestId: "r1", method: "confirm", title: "Allow?" } });
		expect(h.of("sendMessage")).toHaveLength(2);
	});

	it("treats a transcript like typed text: commands are not forwarded and it can answer a question", async () => {
		const h = harness({ download: async () => Buffer.from("ogg") });
		await h.daemonSays({ type: "ready", agentState: "idle", voice: { transcribe: true, speak: false } });
		await h.voice();
		const first = (h.sent[0] as { requestId: string }).requestId;
		await h.daemonSays({ type: "voice_transcript", requestId: first, text: "/login" });
		await h.daemonSays({ type: "ask", ask: { requestId: "r1", method: "input", title: "Name?" } });
		await h.voice();
		const second = (h.sent[1] as { requestId: string }).requestId;
		await h.daemonSays({ type: "voice_transcript", requestId: second, text: "Weekly notes" });
		expect(h.sent.slice(2)).toEqual([{ type: "ui_response", requestId: "r1", value: "Weekly notes" }]);
	});
});
