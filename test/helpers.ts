import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { Bridge, type BridgeOptions } from "../src/bridge.ts";
import type { ClientMessage, ServerPayload } from "../src/protocol.ts";

export interface ApiCall {
	method: string;
	payload: Record<string, unknown>;
}

export const OWNER = 42;
export const STRANGER = 666;

/** A bot whose Bot API calls are recorded instead of sent, plus a fake daemon connection. */
export function harness(options: Partial<BridgeOptions> = {}) {
	const bot = new Bot("123:test", {
		botInfo: {
			id: 1,
			is_bot: true,
			first_name: "Dot",
			username: "dot_test_bot",
			can_join_groups: false,
			can_read_all_group_messages: false,
			supports_inline_queries: false,
			can_connect_to_business: false,
			has_main_web_app: false,
		} as never,
	});
	const calls: ApiCall[] = [];
	let messageId = 100;
	const failing = new Set<string>();
	bot.api.config.use(async (_prev, method, payload) => {
		calls.push({ method, payload: payload as Record<string, unknown> });
		if (failing.has(method)) return { ok: false, error_code: 400, description: "Bad Request" } as never;
		if (method === "sendMessage") {
			const p = payload as { chat_id: number; text: string };
			return {
				ok: true,
				result: { message_id: ++messageId, date: 0, chat: { id: p.chat_id, type: "private" }, text: p.text },
			} as never;
		}
		if (method === "getFile") {
			return { ok: true, result: { file_id: "f", file_unique_id: "u", file_path: "voice/file.oga" } } as never;
		}
		return { ok: true, result: true } as never;
	});
	const sent: ClientMessage[] = [];
	const daemon = {
		connected: true,
		send(message: ClientMessage) {
			if (!daemon.connected) return false;
			sent.push(message);
			return true;
		},
	};
	const bridge = new Bridge({
		bot,
		daemon,
		allowedUsers: new Set([OWNER]),
		log: () => {},
		draftRefreshMs: 60_000,
		...options,
	});
	let updateId = 0;
	const update = (partial: Omit<Update, "update_id">) => bot.handleUpdate({ update_id: ++updateId, ...partial });
	const text = (value: string, from = OWNER, chatType: "private" | "group" = "private") =>
		update({
			message: {
				message_id: ++updateId,
				date: 0,
				chat:
					chatType === "private"
						? { id: from, type: "private", first_name: "U" }
						: { id: -100, type: "group", title: "G" },
				from: { id: from, is_bot: false, first_name: "U" },
				text: value,
				...(value.startsWith("/")
					? { entities: [{ type: "bot_command", offset: 0, length: value.split(" ")[0]?.length ?? 0 }] }
					: {}),
			},
		});
	const daemonSays = (payload: ServerPayload) => bridge.handleDaemon({ ...payload, seq: 0 });
	const of = (method: string) => calls.filter((call) => call.method === method);
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	return { bot, bridge, calls, sent, daemon, update, text, daemonSays, of, failing, settle };
}
