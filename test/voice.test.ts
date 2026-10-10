import { describe, expect, it } from "vitest";
import { harness, STRANGER } from "./helpers.ts";

const audio = Buffer.from("OggS fake opus bytes");

function voiceHarness(download: (path: string) => Promise<Buffer> = async () => audio) {
	const logs: string[] = [];
	const h = harness({ download, log: (line) => logs.push(line) });
	return { ...h, logs };
}

const texts = (h: ReturnType<typeof voiceHarness>) => h.of("sendMessage").map((c) => c.payload.text);

describe("voice notes (S10)", () => {
	it("explains that transcription needs an OpenAI key when the daemon cannot transcribe", async () => {
		const h = voiceHarness();
		await h.daemonSays({ type: "ready", agentState: "idle", voice: { transcribe: false, speak: false } });
		await h.voice();
		expect(h.sent).toEqual([]);
		expect(texts(h)).toEqual(["Voice notes need an OpenAI API key connected in Gentle Dot."]);
	});

	it("downloads the note, transcribes it, shows the transcript and sends it as a message", async () => {
		const paths: string[] = [];
		const h = voiceHarness(async (path) => {
			paths.push(path);
			return audio;
		});
		await h.daemonSays({ type: "ready", agentState: "idle", voice: { transcribe: true, speak: false } });
		await h.voice();
		expect(h.of("getFile").map((c) => c.payload.file_id)).toEqual(["voice-1"]);
		expect(paths).toEqual(["voice/file.oga"]);
		const [request] = h.sent;
		expect(request).toMatchObject({ type: "voice_transcribe", mime: "audio/ogg", data: audio.toString("base64") });
		const requestId = (request as { requestId: string }).requestId;
		await h.daemonSays({ type: "voice_transcript", requestId, text: "remind me to call Ana" });
		expect(texts(h)).toEqual(["🎙️ remind me to call Ana"]);
		expect(h.sent.at(-1)).toEqual({ type: "send", text: "remind me to call Ana" });
	});

	it("follows the voice capability from auth_providers", async () => {
		const h = voiceHarness();
		await h.daemonSays({ type: "ready", agentState: "idle" });
		await h.daemonSays({ type: "auth_providers", voice: { transcribe: true, speak: true } });
		await h.voice();
		expect(h.sent[0]?.type).toBe("voice_transcribe");
	});

	it("refuses a note too long for the daemon", async () => {
		const h = voiceHarness(async () => Buffer.alloc(720_001));
		await h.daemonSays({ type: "ready", agentState: "idle", voice: { transcribe: true, speak: false } });
		await h.voice();
		expect(h.sent).toEqual([]);
		expect(texts(h)).toEqual(["That voice note is too long; keep it under about a minute."]);
	});

	it("says when nothing was heard", async () => {
		const h = voiceHarness();
		await h.daemonSays({ type: "ready", agentState: "idle", voice: { transcribe: true, speak: false } });
		await h.voice();
		const requestId = (h.sent[0] as { requestId: string }).requestId;
		await h.daemonSays({ type: "voice_transcript", requestId, text: "  " });
		expect(texts(h)).toEqual(["I could not hear anything in that voice note."]);
		expect(h.sent).toHaveLength(1);
	});

	it("relays why transcription was unavailable, and ignores other windows' voice results", async () => {
		const h = voiceHarness();
		await h.daemonSays({ type: "ready", agentState: "idle", voice: { transcribe: true, speak: false } });
		await h.voice();
		const requestId = (h.sent[0] as { requestId: string }).requestId;
		await h.daemonSays({ type: "voice_transcript", requestId: "desktop-1", text: "not ours" });
		await h.daemonSays({ type: "voice_unavailable", requestId: "desktop-2", reason: "not ours" });
		await h.daemonSays({ type: "voice_unavailable", requestId, reason: "OpenAI is rate limiting you." });
		expect(texts(h)).toEqual(["OpenAI is rate limiting you."]);
		expect(h.sent).toHaveLength(1);
	});

	it("reports a failed download without logging the bot token", async () => {
		const h = voiceHarness(async () => {
			throw new Error("fetch failed");
		});
		await h.daemonSays({ type: "ready", agentState: "idle", voice: { transcribe: true, speak: false } });
		await h.voice();
		expect(h.sent).toEqual([]);
		expect(texts(h)).toEqual(["I could not download that voice note. Try again."]);
		expect(h.logs.join("\n")).not.toContain("123:test");
	});

	it("ignores a stranger's voice note", async () => {
		const h = voiceHarness();
		await h.daemonSays({ type: "ready", agentState: "idle", voice: { transcribe: true, speak: false } });
		await h.voice(STRANGER);
		expect(h.calls).toEqual([]);
		expect(h.sent).toEqual([]);
	});
});
