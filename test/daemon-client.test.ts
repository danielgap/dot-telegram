import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { DaemonClient, reconnectDelay } from "../src/daemon-client.ts";
import type { ServerMessage } from "../src/protocol.ts";

interface FakeDaemon {
	url: string;
	frames: unknown[];
	sockets: WebSocket[];
	nextSocket(): Promise<WebSocket>;
	close(): Promise<void>;
}

async function fakeDaemon(): Promise<FakeDaemon> {
	const server = new WebSocketServer({ port: 0 });
	await new Promise((resolve) => server.once("listening", resolve));
	const frames: unknown[] = [];
	const sockets: WebSocket[] = [];
	const waiting: ((ws: WebSocket) => void)[] = [];
	server.on("connection", (ws) => {
		sockets.push(ws);
		ws.on("message", (data) => frames.push(JSON.parse(String(data))));
		waiting.shift()?.(ws);
	});
	const { port } = server.address() as { port: number };
	return {
		url: `ws://127.0.0.1:${port}/ws`,
		frames,
		sockets,
		nextSocket: () => new Promise((resolve) => waiting.push(resolve)),
		close: () =>
			new Promise((resolve) => {
				for (const ws of server.clients) ws.terminate();
				server.close(() => resolve());
			}),
	};
}

function tokenFile(value: string): string {
	const file = join(mkdtempSync(join(tmpdir(), "dot-telegram-")), "token");
	writeFileSync(file, `${value}\n`);
	return file;
}

const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true), { timeout: 2000 });

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	for (const step of cleanup.reverse()) await step();
	cleanup = [];
});

async function setup(options: { delay?: (attempt: number) => number; log?: (line: string) => void } = {}) {
	const daemon = await fakeDaemon();
	const file = tokenFile("key-1");
	const received: ServerMessage[] = [];
	const fatal: string[] = [];
	const client = new DaemonClient({
		url: daemon.url,
		tokenFile: file,
		onMessage: (message) => received.push(message),
		onFatal: (reason) => fatal.push(reason),
		delay: options.delay ?? (() => 10),
		log: options.log,
	});
	cleanup.push(() => daemon.close(), () => client.stop());
	return { daemon, file, received, fatal, client };
}

describe("DaemonClient", () => {
	it("says hello with the access key and protocol 1 before anything else", async () => {
		const { daemon, client } = await setup();
		const socket = daemon.nextSocket();
		client.start();
		await socket;
		await until(() => daemon.frames.length === 1);
		expect(daemon.frames[0]).toEqual({ type: "hello", token: "key-1", protocol: 1 });
	});

	it("hands daemon messages to onMessage and sends client messages", async () => {
		const { daemon, client, received } = await setup();
		const next = daemon.nextSocket();
		client.start();
		const ws = await next;
		ws.send(JSON.stringify({ type: "ready", agentState: "idle", seq: 1 }));
		await until(() => received.length === 1);
		expect(received[0]).toEqual({ type: "ready", agentState: "idle", seq: 1 });
		expect(client.send({ type: "abort" })).toBe(true);
		await until(() => daemon.frames.length === 2);
		expect(daemon.frames[1]).toEqual({ type: "abort" });
	});

	it("ignores frames that are not JSON objects", async () => {
		const { daemon, client, received } = await setup();
		const next = daemon.nextSocket();
		client.start();
		const ws = await next;
		ws.send("not json");
		ws.send(JSON.stringify({ type: "agent_state", state: "idle", seq: 2 }));
		await until(() => received.length === 1);
		expect(received[0]?.type).toBe("agent_state");
	});

	it("refuses to send while disconnected", async () => {
		const { client } = await setup();
		expect(client.send({ type: "abort" })).toBe(false);
	});

	it("reconnects after the connection drops and reads the key again", async () => {
		const { daemon, client, file } = await setup();
		let next = daemon.nextSocket();
		client.start();
		const first = await next;
		await until(() => daemon.frames.length === 1);
		writeFileSync(file, "key-2\n");
		next = daemon.nextSocket();
		first.close(1001, "restarting");
		await next;
		await until(() => daemon.frames.length === 2);
		expect(daemon.frames[1]).toEqual({ type: "hello", token: "key-2", protocol: 1 });
	});

	it.each([
		[4401, "access key"],
		[4400, "protocol"],
	])("stops on close code %i and reports it (%s)", async (code, words) => {
		const { daemon, client, fatal } = await setup();
		const next = daemon.nextSocket();
		client.start();
		(await next).close(code, "no");
		await until(() => fatal.length === 1);
		expect(fatal[0]).toContain(words);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(daemon.sockets).toHaveLength(1);
	});

	it("reports a missing key file as fatal", async () => {
		const fatal: string[] = [];
		const client = new DaemonClient({
			url: "ws://127.0.0.1:1/ws",
			tokenFile: "/nonexistent/dot-telegram/token",
			onMessage: () => {},
			onFatal: (reason) => fatal.push(reason),
			delay: () => 10,
		});
		cleanup.push(() => client.stop());
		client.start();
		await until(() => fatal.length === 1);
		expect(fatal[0]).toContain("/nonexistent/dot-telegram/token");
	});

	it("keeps retrying while the daemon is down", async () => {
		const daemon = await fakeDaemon();
		const url = daemon.url;
		await daemon.close();
		let attempts = 0;
		const client = new DaemonClient({
			url,
			tokenFile: tokenFile("key"),
			onMessage: () => {},
			onFatal: () => {},
			delay: (attempt) => {
				attempts = attempt;
				return 5;
			},
		});
		cleanup.push(() => client.stop());
		client.start();
		await until(() => attempts >= 3);
	});
});

describe("DaemonClient backoff and key file", () => {
	it("keeps growing the delay while the daemon accepts and drops the connection without answering", async () => {
		const daemon = await fakeDaemon();
		const attempts: number[] = [];
		const client = new DaemonClient({
			url: daemon.url,
			tokenFile: tokenFile("key"),
			onMessage: () => {},
			onFatal: () => {},
			delay: (attempt) => {
				attempts.push(attempt);
				return 5;
			},
		});
		cleanup.push(() => daemon.close(), () => client.stop());
		const dropAll = async () => {
			for (;;) {
				const ws = await daemon.nextSocket();
				ws.close(1011, "busy");
			}
		};
		void dropAll();
		client.start();
		await until(() => attempts.length >= 3);
		expect(attempts.slice(0, 3)).toEqual([1, 2, 3]);
	});

	it("starts the delay over once the daemon answered", async () => {
		const attempts: number[] = [];
		const { daemon, client } = await setup({
			delay: (attempt) => {
				attempts.push(attempt);
				return 5;
			},
		});
		let next = daemon.nextSocket();
		client.start();
		let ws = await next;
		next = daemon.nextSocket();
		ws.close(1011, "busy");
		ws = await next;
		ws.send(JSON.stringify({ type: "ready", agentState: "idle", seq: 1 }));
		await new Promise((resolve) => setTimeout(resolve, 30));
		next = daemon.nextSocket();
		ws.close(1011, "busy");
		await next;
		expect(attempts).toEqual([1, 1]);
	});

	it("keeps retrying when the key file is briefly missing after a connection", async () => {
		const logs: string[] = [];
		const { daemon, client, file, fatal } = await setup({ log: (line) => logs.push(line) });
		let next = daemon.nextSocket();
		client.start();
		const first = await next;
		first.send(JSON.stringify({ type: "ready", agentState: "idle", seq: 1 }));
		await new Promise((resolve) => setTimeout(resolve, 30));
		rmSync(file);
		next = daemon.nextSocket();
		first.close(1001, "restarting");
		await new Promise((resolve) => setTimeout(resolve, 50));
		writeFileSync(file, "key-3\n");
		await next;
		await until(() => daemon.frames.length === 2);
		expect(daemon.frames[1]).toEqual({ type: "hello", token: "key-3", protocol: 1 });
		expect(fatal).toEqual([]);
		expect(logs.some((line) => line.includes("access key"))).toBe(true);
	});
});

describe("reconnectDelay", () => {
	it("doubles from one second and stops at thirty", () => {
		expect([1, 2, 3, 4, 5, 6, 7, 20].map(reconnectDelay)).toEqual([
			1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
		]);
	});
});
