import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daemonUploader, UploadRefused, uploadUrl } from "../src/uploads.ts";

function tokenFile(value = "secret-key\n"): string {
	const file = join(mkdtempSync(join(tmpdir(), "dot-telegram-")), "token");
	writeFileSync(file, value);
	return file;
}

const uploaded = { uploadId: "up-12345678", name: "a.pdf", size: 3, mime: "application/pdf", path: "uploads/up-12345678/a.pdf" };

describe("uploadUrl", () => {
	it("derives the daemon's HTTP upload address from its WebSocket address", () => {
		expect(uploadUrl("ws://127.0.0.1:4317/ws")).toBe("http://127.0.0.1:4317/upload");
		expect(uploadUrl("wss://dot.example.com/ws")).toBe("https://dot.example.com/upload");
		expect(uploadUrl("wss://dot.example.com/base/ws")).toBe("https://dot.example.com/base/upload");
	});
});

describe("daemonUploader", () => {
	it("posts the raw bytes with the key in the Authorization header and the URI-encoded name", async () => {
		const requests: { url: string; init: RequestInit }[] = [];
		const upload = daemonUploader({
			daemonUrl: "ws://127.0.0.1:4317/ws",
			tokenFile: tokenFile(),
			fetch: async (url, init) => {
				requests.push({ url: String(url), init: init ?? {} });
				return new Response(JSON.stringify(uploaded), { status: 200 });
			},
		});
		const result = await upload({ name: "año 1.pdf", data: Buffer.from("abc") });
		expect(result).toEqual(uploaded);
		expect(requests).toHaveLength(1);
		const [request] = requests;
		expect(request?.url).toBe("http://127.0.0.1:4317/upload");
		expect(request?.init.method).toBe("POST");
		expect(request?.init.headers).toEqual({
			Authorization: "Bearer secret-key",
			"Content-Type": "application/octet-stream",
			"X-File-Name": encodeURIComponent("año 1.pdf"),
		});
		expect(Buffer.from(request?.init.body as Uint8Array).toString()).toBe("abc");
	});

	it("sends X-Upload-Id when adding to an earlier upload", async () => {
		let headers: Record<string, string> = {};
		const upload = daemonUploader({
			daemonUrl: "ws://127.0.0.1:4317/ws",
			tokenFile: tokenFile(),
			fetch: async (_url, init) => {
				headers = init?.headers as Record<string, string>;
				return new Response(JSON.stringify(uploaded), { status: 200 });
			},
		});
		await upload({ name: "b.pdf", data: Buffer.from("x"), uploadId: "up-12345678" });
		expect(headers["X-Upload-Id"]).toBe("up-12345678");
	});

	it("turns the daemon's refusal into UploadRefused with its message", async () => {
		const upload = daemonUploader({
			daemonUrl: "ws://127.0.0.1:4317/ws",
			tokenFile: tokenFile(),
			fetch: async () =>
				new Response(JSON.stringify({ code: "too_large", message: "That file is bigger than 25 MB." }), {
					status: 413,
				}),
		});
		const error = await upload({ name: "a", data: Buffer.from("x") }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(UploadRefused);
		expect((error as Error).message).toBe("That file is bigger than 25 MB.");
	});

	it("fails without the key in its message when the daemon cannot be reached", async () => {
		const upload = daemonUploader({
			daemonUrl: "ws://127.0.0.1:4317/ws",
			tokenFile: tokenFile(),
			fetch: async () => {
				throw new Error("connect ECONNREFUSED secret-key");
			},
		});
		const error = (await upload({ name: "a", data: Buffer.from("x") }).catch((e: unknown) => e)) as Error;
		expect(error).not.toBeInstanceOf(UploadRefused);
		expect(error.message).toBe("network error");
	});

	it("fails when the key file is missing", async () => {
		const upload = daemonUploader({
			daemonUrl: "ws://127.0.0.1:4317/ws",
			tokenFile: "/nonexistent/dot-telegram/token",
			fetch: async () => new Response("{}"),
		});
		const error = (await upload({ name: "a", data: Buffer.from("x") }).catch((e: unknown) => e)) as Error;
		expect(error).not.toBeInstanceOf(UploadRefused);
		expect(error.message).toBe("cannot read the access key");
	});
});
