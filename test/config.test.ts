import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

const home = "/home/someone";
const base = { TELEGRAM_BOT_TOKEN: "123:abc", DOT_TELEGRAM_ALLOWED_USERS: "42" };

describe("loadConfig", () => {
	it("applies the documented defaults", () => {
		expect(loadConfig(base, home)).toEqual({
			botToken: "123:abc",
			allowedUsers: new Set([42]),
			daemonUrl: "ws://127.0.0.1:4317/ws",
			tokenFile: "/home/someone/.gentle-dot/token",
		});
	});

	it("reads overrides and several user ids", () => {
		const config = loadConfig(
			{
				...base,
				DOT_TELEGRAM_ALLOWED_USERS: " 42, 7 ",
				GENTLE_DOT_URL: "ws://10.0.0.2:4317/ws",
				GENTLE_DOT_TOKEN_FILE: "/srv/dot/token",
			},
			home,
		);
		expect(config.allowedUsers).toEqual(new Set([42, 7]));
		expect(config.daemonUrl).toBe("ws://10.0.0.2:4317/ws");
		expect(config.tokenFile).toBe("/srv/dot/token");
	});

	it.each([
		[{ DOT_TELEGRAM_ALLOWED_USERS: "42" }, "TELEGRAM_BOT_TOKEN"],
		[{ TELEGRAM_BOT_TOKEN: "123:abc" }, "DOT_TELEGRAM_ALLOWED_USERS"],
		[{ ...base, DOT_TELEGRAM_ALLOWED_USERS: " , " }, "DOT_TELEGRAM_ALLOWED_USERS"],
		[{ ...base, DOT_TELEGRAM_ALLOWED_USERS: "42,abc" }, "DOT_TELEGRAM_ALLOWED_USERS"],
		[{ ...base, DOT_TELEGRAM_ALLOWED_USERS: "-5" }, "DOT_TELEGRAM_ALLOWED_USERS"],
		[{ ...base, GENTLE_DOT_URL: "http://127.0.0.1:4317/ws" }, "GENTLE_DOT_URL"],
	])("rejects %j naming %s", (env, variable) => {
		expect(() => loadConfig(env, home)).toThrow(ConfigError);
		expect(() => loadConfig(env, home)).toThrow(variable);
	});

	it("never repeats the bot token in an error", () => {
		const env = { TELEGRAM_BOT_TOKEN: "123:secret-value", DOT_TELEGRAM_ALLOWED_USERS: "x" };
		expect(() => loadConfig(env, home)).toThrow(/^(?!.*secret-value)/s);
	});
});
