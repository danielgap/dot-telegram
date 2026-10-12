import type { Message } from "grammy/types";
import { describe, expect, it } from "vitest";
import type { Upload } from "../src/bridge.ts";
import type { UploadedFile } from "../src/protocol.ts";
import { UploadRefused } from "../src/uploads.ts";
import { harness, OWNER, STRANGER } from "./helpers.ts";

const bytes = Buffer.from("%PDF-1.7 fake");

function fileHarness(upload?: (file: Upload) => Promise<UploadedFile>) {
	const logs: string[] = [];
	const uploads: Upload[] = [];
	const downloads: string[] = [];
	const h = harness({
		log: (line) => logs.push(line),
		download: async (path) => {
			downloads.push(path);
			return bytes;
		},
		upload:
			upload ??
			(async (file) => {
				uploads.push(file);
				return {
					uploadId: "up-12345678",
					name: file.name,
					size: file.data.length,
					mime: "application/pdf",
					path: `uploads/up-12345678/${file.name}`,
				};
			}),
	});
	const media = (fields: Partial<Message>, from = OWNER) =>
		h.update({
			message: {
				message_id: 1,
				date: 0,
				chat: { id: from, type: "private", first_name: "U" },
				from: { id: from, is_bot: false, first_name: "U" },
				...fields,
			} as never,
		});
	const texts = () => h.of("sendMessage").map((c) => c.payload.text);
	return { ...h, logs, uploads, downloads, media, texts };
}

const doc = (size = bytes.length, name: string | null = "report.pdf") => ({
	document: { file_id: "doc-1", file_unique_id: "d1", file_size: size, ...(name ? { file_name: name } : {}) },
});

describe("files sent to the assistant", () => {
	it("downloads a document, uploads it to the daemon and sends it with its caption", async () => {
		const h = fileHarness();
		await h.media({ ...doc(), caption: "summarise this" });
		expect(h.of("getFile").map((c) => c.payload.file_id)).toEqual(["doc-1"]);
		expect(h.downloads).toEqual(["voice/file.oga"]);
		expect(h.uploads).toEqual([{ name: "report.pdf", data: bytes }]);
		expect(h.sent).toEqual([
			{ type: "send", text: "summarise this", attachments: [{ uploadId: "up-12345678", name: "report.pdf" }] },
		]);
		expect(h.of("sendMessageDraft")).toHaveLength(1);
	});

	it("sends a file without a caption as an empty text", async () => {
		const h = fileHarness();
		await h.media(doc());
		expect(h.sent).toEqual([
			{ type: "send", text: "", attachments: [{ uploadId: "up-12345678", name: "report.pdf" }] },
		]);
	});

	it("sends the largest size of a photo, named after it", async () => {
		const h = fileHarness();
		await h.media({
			photo: [
				{ file_id: "small", file_unique_id: "s", width: 90, height: 90, file_size: 1_000 },
				{ file_id: "big", file_unique_id: "ph1", width: 1280, height: 1280, file_size: 90_000 },
			],
			caption: "what is this?",
		});
		expect(h.of("getFile").map((c) => c.payload.file_id)).toEqual(["big"]);
		expect(h.uploads.map((u) => u.name)).toEqual(["photo-ph1.jpg"]);
		expect(h.sent[0]).toMatchObject({ type: "send", text: "what is this?" });
	});

	it("names videos and audio without a file name after their type", async () => {
		const h = fileHarness();
		await h.media({ video: { file_id: "v", file_unique_id: "v1", width: 1, height: 1, duration: 1 } });
		await h.media({ audio: { file_id: "a", file_unique_id: "a1", duration: 1, mime_type: "audio/mpeg" } });
		await h.media({ ...doc(bytes.length, null) });
		expect(h.uploads.map((u) => u.name)).toEqual(["video-v1.mp4", "audio-a1.mp3", "file-d1"]);
	});

	it("refuses a file over Telegram's 20 MB download limit without downloading it", async () => {
		const h = fileHarness();
		await h.media(doc(20 * 1024 * 1024 + 1));
		expect(h.of("getFile")).toEqual([]);
		expect(h.uploads).toEqual([]);
		expect(h.sent).toEqual([]);
		expect(h.texts()).toEqual(["That file is too big: Telegram lets bots download files up to 20 MB."]);
	});

	it("reports a failed download without logging the bot token", async () => {
		const h = fileHarness();
		h.failing.add("getFile");
		await h.media(doc());
		expect(h.sent).toEqual([]);
		expect(h.texts()).toEqual(["I could not download that file. Try again."]);
		expect(h.logs.join("\n")).not.toContain("123:test");
	});

	it("relays the daemon's reason when it refuses the upload", async () => {
		const h = fileHarness(async () => {
			throw new UploadRefused("That file is bigger than 25 MB.");
		});
		await h.media(doc());
		expect(h.sent).toEqual([]);
		expect(h.texts()).toEqual(["⚠️ That file is bigger than 25 MB."]);
	});

	it("says Gentle Dot is unreachable when the upload cannot connect", async () => {
		const h = fileHarness(async () => {
			throw new Error("network error");
		});
		await h.media(doc());
		expect(h.sent).toEqual([]);
		expect(h.texts()).toEqual(["Gentle Dot is not reachable right now. Is it running?"]);
	});

	it("asks for a text answer while a question waits for one, and uploads nothing", async () => {
		const h = fileHarness();
		await h.daemonSays({ type: "ask", ask: { requestId: "r1", method: "input", title: "Name?" } });
		await h.media(doc());
		expect(h.uploads).toEqual([]);
		expect(h.sent).toEqual([]);
		expect(h.texts().at(-1)).toBe("Answer the question with a text message, or /cancel.");
	});

	it("ignores a stranger's file", async () => {
		const h = fileHarness();
		await h.media(doc(), STRANGER);
		expect(h.calls).toEqual([]);
		expect(h.uploads).toEqual([]);
		expect(h.sent).toEqual([]);
	});

	it("keeps plain text messages without attachments", async () => {
		const h = fileHarness();
		await h.text("hello");
		expect(h.sent).toEqual([{ type: "send", text: "hello" }]);
	});
});
