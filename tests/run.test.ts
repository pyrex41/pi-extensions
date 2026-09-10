import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_OUTPUT_BYTES, checked, runBin } from "../extensions/lib/run.ts";

test("pre-aborted operations never execute", async () => {
	const controller = new AbortController(); controller.abort();
	const result = await runBin(process.execPath, ["-e", "throw Error('must not run')"], { cwd: tmpdir(), signal: controller.signal });
	assert.equal(result.code, 130); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
});
test("output is bounded during capture, retains tail and reports discard", async () => {
	const result = await runBin(process.execPath, ["-e", "process.stdout.write('a'.repeat(500000)+'TAIL'); process.stderr.write('b'.repeat(500000))"], { cwd: tmpdir(), timeoutMs: 5000 });
	assert.equal(result.ok, true);
	assert.ok(Buffer.byteLength(result.stdout) < MAX_OUTPUT_BYTES + 100);
	assert.ok(result.stdout.startsWith("[Earlier output discarded")); assert.ok(result.stdout.endsWith("TAIL"));
	assert.ok(Buffer.byteLength(result.stderr) < MAX_OUTPUT_BYTES + 100);
});
test("machine-output failures are bounded before becoming Pi errors", () => {
	assert.throws(() => checked({ ok: false, code: 1, stdout: "x".repeat(100000), stderr: "failure detail" }), error => {
		assert.ok(error instanceof Error);
		assert.ok(Buffer.byteLength(error.message) < MAX_OUTPUT_BYTES + 100);
		assert.ok(error.message.endsWith("failure detail"));
		return true;
	});
});
test("line count is bounded even for short lines", async () => {
	const result = await runBin(process.execPath, ["-e", "console.log('x\\n'.repeat(10000))"], { cwd: tmpdir(), timeoutMs: 5000 });
	assert.ok(result.stdout.split("\n").length <= 951);
});
test("missing binaries return actionable failure", async () => {
	const result = await runBin("/does-not-exist/pi-test", [], { cwd: tmpdir(), timeoutMs: 1000 });
	assert.equal(result.ok, false); assert.equal(result.code, 127);
});
test("timeout escalates and stops descendants that ignore SIGTERM", { skip: process.platform === "win32" }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-run-test-"));
	try {
		const pidFile = join(dir, "pid");
		const grandchild = `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},100);`;
		const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'}); process.on('SIGTERM',()=>{}); setInterval(()=>{},100);`;
		const result = await runBin(process.execPath, ["-e", parent], { cwd: dir, timeoutMs: 1000 });
		assert.equal(result.code, 124);
		const pid = Number(await readFile(pidFile, "utf8"));
		let alive = true;
		for (let i = 0; i < 30; i++) {
			try { process.kill(pid, 0); } catch { alive = false; break; }
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		assert.equal(alive, false, "grandchild must be reaped");
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("abort during execution is not reported as success", async () => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 100);
	try {
		const result = await runBin(process.execPath, ["-e", "setInterval(()=>{},100)"], { cwd: tmpdir(), signal: controller.signal, timeoutMs: 5000 });
		assert.equal(result.ok, false); assert.equal(result.code, 130);
	} finally { clearTimeout(timer); }
});
