import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sbExtension from "../extensions/shen-backpressure/index.ts";
import { getSbProject } from "../extensions/shen-backpressure/project.ts";
import { assertVerified, gateState } from "../extensions/shen-backpressure/verification.ts";
import { findOnPath } from "../extensions/lib/run.ts";
import { harness } from "./harness.ts";

const bin = process.env.SB_BIN || findOnPath("sb");
async function project(dir: string) {
	await writeFile(join(dir, "core.shen"), "(datatype example X : number; ==== (sample X) : sample;)\n");
	await writeFile(join(dir, "guards.ts"), "// integration test output\n");
	await writeFile(join(dir, "mode"), "pass");
	await writeFile(join(dir, "gate.cjs"), `const fs = require('fs');
console.log('first report line'); console.log('important second report line');
const mode = fs.readFileSync('mode','utf8');
if (mode === 'drift') fs.writeFileSync('source.ts','changed during gates');
if (mode === 'fail') { console.error('specific failure diagnostic'); process.exit(1); }
`);
	await writeFile(join(dir, "sb.toml"), `[project]\nlang = "ts"\npkg = "example"\n[paths]\nspec = "core.shen"\noutput = "guards.ts"\n[[gates]]\nname = "integration-check"\nkind = "command"\nrun = "node gate.cjs"\n`);
}

test("nested sketches are never auto-activated", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-sb-root-"));
	try {
		await mkdir(join(dir, "specs")); await project(join(dir, "specs"));
		assert.equal(getSbProject(dir), undefined);
		if (bin) {
			const h = harness(dir); sbExtension(h.api);
			await assert.rejects(h.call("sb", { op: "context" }), /unconfigured/);
		}
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("invalid and missing spec manifests fail closed", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-sb-invalid-"));
	try {
		await writeFile(join(dir, "sb.toml"), "[paths]\nspec = 'missing.shen'\noutput = 'guards.ts'\n");
		assert.throws(() => getSbProject(dir), /spec missing/);
		await writeFile(join(dir, "sb.toml"), "[project]\nlang='ts'\n");
		assert.throws(() => getSbProject(dir), /must declare/);
		const h = harness(dir); sbExtension(h.api);
		const result = await h.event("tool_call", { toolName: "todo", input: { op: "done", id: "1" } });
		assert.equal(result[0].block, true);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("untrusted projects neither hydrate prompts nor execute commands", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-sb-trust-"));
	try {
		await project(dir);
		const h = harness(dir); h.ctx.isProjectTrusted = () => false; sbExtension(h.api);
		assert.deepEqual(await h.event("before_agent_start", { systemPrompt: "base" }), [undefined]);
		await assert.rejects(h.call("sb", { op: "gates" }), /Trust this project/);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("real SB: gate state, stale content, generated-file protection and slash reports", { skip: !bin }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-sb-test-"));
	try {
		await project(dir);
		const h = harness(dir); sbExtension(h.api);
		await h.event("session_start");
		assert.equal(gateState(dir).status, "unknown");
		await assert.rejects(assertVerified(dir), /blocked/);
		const guardCall = await h.event("tool_call", { toolName: "edit", input: { path: "guards.ts" } });
		assert.equal(guardCall[0].block, true);
		await symlink(join(dir, "guards.ts"), join(dir, "alias.ts"));
		const aliasCall = await h.event("tool_call", { toolName: "write", input: { path: "alias.ts" } });
		assert.equal(aliasCall[0].block, true);
		await h.call("sb", { op: "gates" });
		await assertVerified(dir); assert.equal(gateState(dir).status, "passed");
		await writeFile(join(dir, "source.ts"), "new input");
		await assert.rejects(assertVerified(dir), /blocked/);
		assert.equal(gateState(dir).status, "stale");
		await writeFile(join(dir, "mode"), "fail");
		await assert.rejects(h.call("sb", { op: "gates" }), /specific failure diagnostic/);
		assert.equal(gateState(dir).status, "failed");
		await h.call("sb", { op: "context" });
		assert.equal(gateState(dir).status, "failed");
		assert.ok(String(h.widgets.get("sb-status")).includes("failed"));
		await h.commands.get("sb-gates")!.handler("", h.ctx);
		assert.ok(String(h.messages.at(-1)?.content).includes("specific failure diagnostic"));
		await h.commands.get("sb")!.handler("", h.ctx);
		assert.ok(String(h.messages.at(-1)?.content).includes("integration-check"));
		await writeFile(join(dir, "mode"), "drift");
		await assert.rejects(h.call("sb", { op: "gates" }), /inputs changed/);
		await writeFile(join(dir, "mode"), "pass");
		await h.call("sb", { op: "gates" });
		await h.event("tool_result", { toolName: "bash", input: { command: "git status" } });
		assert.equal(gateState(dir).status, "stale");
		await h.call("sb", { op: "gates" });
		await h.event("session_start");
		assert.equal(gateState(dir).status, "unknown", "reload cannot resurrect old evidence");
	} finally { await rm(dir, { recursive: true, force: true }); }
});
