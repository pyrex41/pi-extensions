import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Exercise the real Pi loader and RPC report delivery without making any model/API calls.
test("Pi RPC loads resources once and slash reports immediately enter message history", { timeout: 30_000 }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-rpc-test-"));
	const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const cli = join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "cli.js");
	const child = spawn(process.execPath, [cli, "--mode", "rpc", "--no-session", "--offline", "--approve", "-e", packageRoot], {
		cwd: dir,
		env: { HOME: dir, PATH: process.env.PATH, PI_CODING_AGENT_DIR: join(dir, "agent"), PI_OFFLINE: "1", PI_TELEMETRY: "0" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let buffer = "", stderr = "";
	const pending = new Map<string, (value: any) => void>();
	const errors: unknown[] = [];
	child.stdout.setEncoding("utf8").on("data", (text: string) => {
		buffer += text;
		for (;;) {
			const end = buffer.indexOf("\n"); if (end < 0) break;
			const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
			try {
				const event = JSON.parse(line);
				if (event.type === "extension_error") errors.push(event);
				if (event.type === "response") pending.get(event.id)?.(event);
			} catch { errors.push(line); }
		}
	});
	child.stderr.setEncoding("utf8").on("data", (text: string) => { stderr += text; });
	async function request(id: string, type: string, extra = {}) {
		return new Promise<any>((resolveRequest, reject) => {
			const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout ${id}: ${stderr}`)); }, 10_000);
			pending.set(id, value => { clearTimeout(timer); pending.delete(id); resolveRequest(value); });
			child.stdin.write(`${JSON.stringify({ id, type, ...extra })}\n`);
		});
	}
	try {
		const commands = await request("commands", "get_commands");
		assert.equal(commands.success, true);
		const names = commands.data.commands.map((c: any) => c.name);
		for (const name of ["sb", "sb-gates", "sb-cancel", "sb-fix", "todos", "scud-release", "workflow", "observer", "how"]) assert.equal(names.filter((n: string) => n === name).length, 1, name);
		assert.equal((await request("context", "prompt", { message: "/sb" })).success, true);
		assert.equal((await request("todos", "prompt", { message: "/todos" })).success, true);
		assert.equal((await request("workflow", "prompt", { message: "/workflow status" })).success, true);
		assert.equal((await request("how", "prompt", { message: "/how" })).success, true);
		const history = await request("history", "get_messages");
		assert.ok(history.data.messages.some((m: any) => m.customType === "sb-report"));
		assert.ok(history.data.messages.some((m: any) => m.customType === "scud-report"));
		assert.ok(history.data.messages.some((m: any) => m.customType === "workflow-report"));
		assert.ok(history.data.messages.some((m: any) => m.customType === "observer-shared"));
		assert.equal(history.data.messages.filter((m: any) => m.role === "assistant").length, 0, "status commands must not start paid model turns");
		assert.deepEqual(errors, []);
		assert.doesNotMatch(stderr, /Failed to load extension|Error loading/);
	} finally {
		child.kill("SIGTERM");
		await new Promise<void>(resolveExit => { if (child.exitCode !== null) resolveExit(); else child.once("exit", () => resolveExit()); });
		await rm(dir, { recursive: true, force: true });
	}
});
