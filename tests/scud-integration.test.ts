import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import scudExtension from "../extensions/scud/index.ts";
import { findOnPath, runBin } from "../extensions/lib/run.ts";
import { findProject } from "../extensions/lib/project.ts";
import { registerTodoTool } from "../extensions/scud/todo.ts";
import { validateDependencies } from "../extensions/scud/store.ts";
import { harness } from "./harness.ts";

const bin = process.env.SCUD_BIN || findOnPath("scud");
test("missing CLI and unconfigured projects throw real tool errors", async () => {
	const h = harness(tmpdir());
	registerTodoTool(h.api, runBin, () => undefined);
	await assert.rejects(h.call("todo", { op: "warmup" }), /executable not found/);
});
test("dependency validation includes inherited edges", () => {
	assert.throws(() => validateDependencies([
		{ id: "1", title: "parent", status: "pending", dependencies: [] },
		{ id: "1.1", title: "child", status: "pending", parent_id: "1" },
	], "1", ["1.1"]), /cycle/);
});
test("real SCUD: initialization, dependency edges, ownership, explicit commit and recovery", { skip: !bin }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-scud-test-"));
	try {
		const a = harness(dir, "a"), b = harness(dir, "b");
		scudExtension(a.api); scudExtension(b.api);
		await a.call("todo", { op: "init", items: ["First", "Second"] });
		assert.equal(existsSync(join(dir, ".claude")), false);
		assert.equal(existsSync(join(dir, ".opencode")), false);
		await a.call("todo", { op: "dependencies", id: "2", dependencies: ["1"] });
		await assert.rejects(a.call("todo", { op: "start", id: "2" }), /unmet dependency/);
		await assert.rejects(a.call("todo", { op: "dependencies", id: "1", dependencies: ["2"] }), /cycle/);
		await assert.rejects(a.call("todo", { op: "dependencies", id: "1", dependencies: ["99"] }), /Unknown dependency/);
		const races = await Promise.allSettled([a.call("todo", { op: "start", id: "1" }), b.call("todo", { op: "start", id: "1" })]);
		assert.equal(races.filter(r => r.status === "fulfilled").length, 1);
		const winner = races[0]!.status === "fulfilled" ? a : b, loser = winner === a ? b : a;
		await assert.rejects(loser.call("todo", { op: "done", id: "1" }), /not claimed/);
		await winner.call("todo", { op: "start", id: "1" }); // idempotent
		await runBin("git", ["init", "-q"], { cwd: dir });
		await runBin("git", ["config", "user.name", "Pi Test"], { cwd: dir });
		await runBin("git", ["config", "user.email", "pi-test@example.invalid"], { cwd: dir });
		await writeFile(join(dir, "staged.txt"), "test\n");
		await writeFile(join(dir, "unstaged.txt"), "leave me\n");
		await runBin("git", ["add", "staged.txt"], { cwd: dir });
		await winner.call("todo", { op: "commit", id: "1", message: "verified" });
		const log = await runBin("git", ["log", "-1", "--format=%s"], { cwd: dir });
		assert.equal(log.stdout, "[main:1] verified");
		const files = await runBin("git", ["ls-files"], { cwd: dir });
		assert.equal(files.stdout, "staged.txt");
		await winner.call("todo", { op: "done", id: "1" });
		await assert.rejects(winner.call("todo", { op: "commit", id: "1" }), /not claimed/);
		await loser.call("todo", { op: "start", id: "2" });
		await a.commands.get("scud-release")!.handler("main 2", a.ctx);
		const claims = JSON.parse(await readFile(join(dir, ".scud", "pi-claims.json"), "utf8"));
		assert.deepEqual(claims, {});
		await winner.call("todo", { op: "start", id: "2" });
		await winner.call("todo", { op: "release", id: "2" });
		await a.commands.get("todos")!.handler("", a.ctx);
		assert.ok(String(a.messages.at(-1)?.content).includes("Second"));
		await mkdir(join(dir, "src"));
		assert.equal(findProject(join(dir, "src"), ".scud"), dir);
		await mkdir(join(dir, "src", ".git"));
		assert.equal(findProject(join(dir, "src"), ".scud"), undefined);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("uninitialized projects receive no SCUD workflow injection", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-optin-test-"));
	try {
		const h = harness(dir); scudExtension(h.api);
		assert.deepEqual(await h.event("before_agent_start", { systemPrompt: "base" }), [undefined]);
		assert.equal(existsSync(join(dir, ".scud")), false);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
