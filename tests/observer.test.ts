import assert from "node:assert/strict";
import { test } from "node:test";
import { Observer } from "../extensions/observer/engine.ts";
import observerExtension from "../extensions/observer/index.ts";
import { harness } from "./harness.ts";
import { response, summary, testModel } from "./workbench-fixtures.ts";

test("observer is opt-in, debounced, and sleeps without new evidence", async () => {
	let now = 0, calls = 0; const o = new Observer(() => now);
	const infer = async () => { calls++; return summary; };
	o.setActive(true); await o.tick(90, infer, () => {}); assert.equal(calls, 0);
	o.start("telemetry"); await o.tick(90, infer, () => {}); assert.equal(calls, 1);
	o.startTool("1", "read"); now = 30_000; await o.tick(90, infer, () => {}); assert.equal(calls, 1);
	now = 90_000; await o.tick(90, infer, () => {}); assert.equal(calls, 2);
	now = 91_000; await o.tick(90, infer, () => {}); assert.equal(calls, 2);
	o.endTool("1", "read", false); o.setActive(false); now = 200_000;
	await o.tick(90, infer, () => {}); assert.equal(calls, 3);
	now = 900_000; await o.tick(90, infer, () => {}); assert.equal(calls, 3);
});
test("long silence triggers one waiting check, not an endless paid heartbeat", async () => {
	let now = 0, calls = 0; const o = new Observer(() => now); o.start("telemetry"); o.setActive(true);
	const infer = async () => { calls++; return summary; };
	await o.tick(90, infer, () => {}); now = 200_000; await o.tick(90, infer, () => {});
	assert.equal(calls, 2); assert.equal(o.snapshot().longWait, true);
	now = 600_000; await o.tick(90, infer, () => {}); assert.equal(calls, 2);
});
test("in-flight observation coalesces events, does not overlap, and stop discards late results", async () => {
	let resolve!: (s: string) => void, calls = 0, published = 0;
	const o = new Observer(); o.start("telemetry"); o.setActive(true);
	const infer = async () => { calls++; return new Promise<string>(r => { resolve = r; }); };
	const first = o.tick(90, infer, () => published++);
	await o.tick(90, infer, () => published++); assert.equal(calls, 1);
	o.endTool("1", "write", false); o.stop(); resolve(summary); await first;
	assert.equal(published, 0); assert.equal(o.latest, undefined);
});
test("telemetry never contains notes; opt-in notes are bounded and cleared on stop", () => {
	const o = new Observer(); o.note("before approval"); o.start("telemetry"); o.note("private note");
	assert.equal(o.snapshot().notes, undefined);
	o.start("notes"); for (let i = 0; i < 8; i++) o.note(`note ${i} ` + "x".repeat(2000));
	assert.equal(o.snapshot().notes!.length, 4); assert.ok(o.snapshot().notes!.every(n => Buffer.byteLength(n) < 740));
	o.stop(); assert.deepEqual(o.snapshot().notes, []);
});
test("only explicit gate evidence counts and starting mutation makes it stale immediately", () => {
	const o = new Observer();
	o.endTool("1", "bash", false); assert.equal(o.snapshot().gateStatus, "not observed");
	o.endTool("2", "sb", false, "passed"); assert.equal(o.snapshot().gateStatus, "passed");
	o.startTool("3", "edit"); assert.match(o.snapshot().gateStatus, /stale/);
});
test("invalid summaries pause without retrying or claiming verification", async () => {
	const o = new Observer(); o.start("telemetry"); o.setActive(true);
	await o.tick(90, async () => "not json", () => {});
	assert.equal(o.enabled, false); assert.equal(o.latest, undefined); assert.match(o.error!, /invalid JSON/);
});
test("observer hooks send only allowed telemetry, never raw payloads or thinking", async () => {
	const h = harness("/tmp"); let captured = "";
	h.ctx.isIdle = () => false;
	h.ctx.modelRegistry = { find: () => testModel, hasConfiguredAuth: () => true, complete: async (_m: unknown, context: any) => { captured = context.messages[0].content[0].text; return response(summary); } } as any;
	observerExtension(h.api); await h.event("session_start");
	await h.event("tool_execution_start", { toolCallId: "x", toolName: "bash", args: { command: "RAW_PRIVATE_COMMAND" } });
	await h.event("tool_execution_end", { toolCallId: "x", toolName: "bash", result: { content: [{ type: "text", text: "RAW_PRIVATE_OUTPUT" }] }, isError: false });
	await h.event("message_end", { message: { role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE_THOUGHT" }, { type: "text", text: "PUBLIC_NOTE" }] } });
	await h.commands.get("observer")!.handler("on test-vendor/small telemetry", h.ctx);
	await new Promise(resolve => setTimeout(resolve, 20));
	assert.ok(captured.includes("completedTools"));
	for (const forbidden of ["RAW_PRIVATE_COMMAND", "RAW_PRIVATE_OUTPUT", "PRIVATE_THOUGHT", "PUBLIC_NOTE"]) assert.ok(!captured.includes(forbidden));
	assert.equal(h.messages.length, 0, "automatic reviews must not trigger or inject parent turns");
	assert.ok(h.entries.some(e => e.customType === "observer-update"));
	await h.event("session_shutdown");
});
test("exact progress questions use the cached observer without waking the primary model", async () => {
	const h = harness("/tmp"); let calls = 0;
	h.ctx.isIdle = () => false;
	h.ctx.modelRegistry = { find: () => testModel, hasConfiguredAuth: () => true, complete: async () => { calls++; return response(summary); } } as any;
	observerExtension(h.api); await h.event("session_start");
	await h.commands.get("observer")!.handler("on test-vendor/small", h.ctx);
	await new Promise(resolve => setTimeout(resolve, 20));
	const before = calls;
	assert.deepEqual(await h.event("input", { source: "interactive", text: "btw, how’s it going?" }), [{ action: "handled" }]);
	assert.equal(calls, before); assert.equal(h.messages.at(-1)?.customType, "observer-shared");
	assert.deepEqual(await h.event("input", { source: "interactive", text: "how's it going? also fix auth" }), [undefined]);
	assert.deepEqual(await h.event("input", { source: "interactive", text: "how's it going?", images: [{}] }), [undefined]);
	await h.event("session_shutdown");
});
test("observer off revokes pending consent and concurrent setup cannot double-admit", async () => {
	const h = harness("/tmp"); let calls = 0, confirmations = 0, approve!: (v: boolean) => void;
	h.ctx.isIdle = () => false;
	h.ctx.modelRegistry = { find: () => testModel, hasConfiguredAuth: () => true, complete: async () => { calls++; return response(summary); } } as any;
	h.ctx.ui.confirm = async () => { confirmations++; return new Promise<boolean>(resolve => { approve = resolve; }); };
	observerExtension(h.api); await h.event("session_start");
	const first = h.commands.get("observer")!.handler("on test-vendor/small", h.ctx);
	await h.commands.get("observer")!.handler("on test-vendor/small", h.ctx);
	assert.equal(confirmations, 1);
	await h.commands.get("observer")!.handler("off", h.ctx);
	approve(true); await first;
	assert.equal(calls, 0);
	await h.event("session_shutdown");
});
test("observer never silently picks the primary model or runs when consent is denied", async () => {
	const h = harness("/tmp"); let calls = 0;
	h.ctx.modelRegistry = { find: () => testModel, hasConfiguredAuth: () => true, complete: async () => { calls++; return response(summary); } } as any;
	h.ctx.ui.confirm = async () => false;
	observerExtension(h.api); await h.event("session_start");
	await h.commands.get("observer")!.handler("on test-vendor/small", h.ctx);
	assert.equal(calls, 0);
	await h.event("session_shutdown");
});
