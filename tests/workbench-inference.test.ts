import assert from "node:assert/strict";
import { test } from "node:test";
import { defaults, mergeConfig } from "../extensions/workbench/config.ts";
import { complete, newLedger, reserve, resolveModel, safeText } from "../extensions/workbench/inference.ts";
import { harness } from "./harness.ts";

import { testModel } from "./workbench-fixtures.ts";
const limits = defaults().observer;
test("workbench configuration is data-only, bounded, and cannot enable spending", () => {
	const config = mergeConfig(defaults(), { roles: { observer: "local/luna", skeptic: "another/model" }, observer: { intervalSeconds: 60, maxCalls: 5, maxEstimatedCostUsd: 0.1 } });
	assert.equal(config.roles.observer, "local/luna"); assert.equal(config.observer.intervalSeconds, 60);
	for (const value of [{ enabled: true }, { observer: { intervalSeconds: 1 } }, { workflow: { concurrency: 20 } }, { roles: { observer: "https://host?api_key=private" } }, { observer: { maxCalls: 1.5 } }]) assert.throws(() => mergeConfig(defaults(), value));
});
test("role routing uses arbitrary registered providers without falling back", () => {
	const h = harness("/tmp");
	h.ctx.modelRegistry = { find: (provider: string, id: string) => provider === "test-vendor" && id === "small" ? testModel : undefined, hasConfiguredAuth: () => true } as any;
	assert.equal(resolveModel(h.ctx, "test-vendor/small"), testModel);
	assert.throws(() => resolveModel(h.ctx, "made-up/model"), /No automatic fallback/);
});
test("budget reserves before calls and refuses oversubscription", () => {
	const ledger = newLedger(); const small = { ...limits, maxCalls: 1 };
	reserve(ledger, small, testModel, 2000);
	assert.throws(() => reserve(ledger, small, testModel, 2000), /Budget exhausted/);
	assert.equal(ledger.calls, 1);
	assert.throws(() => reserve(newLedger(), { ...limits, maxEstimatedCostUsd: 0 }, testModel, 2000), /Budget exhausted/);
	assert.throws(() => reserve(newLedger(), limits, { ...testModel, cost: { ...testModel.cost, input: NaN } }, 2000), /invalid pricing/);
});
test("sanitization bounds input and redacts known credential forms", () => {
	const credential = "sk-" + "x".repeat(24);
	const text = safeText(`note ${credential} https://host/?api_key=example-secret\nAuthorization: Bearer example-value\n{"apiKey":"json-placeholder-secret"}`);
	assert.ok(!text.includes(credential)); assert.ok(!text.includes("example-secret")); assert.ok(!text.includes("example-value")); assert.ok(!text.includes("json-placeholder-secret"));
	assert.match(safeText("é".repeat(1000), 100), /TRUNCATED/);
});
test("inference has no tools, forwards cancellation, and keeps charges on errors", async () => {
	const h = harness("/tmp"), ledger = newLedger(); let calls = 0;
	h.ctx.modelRegistry = { complete: async (_model: unknown, context: any, options: any) => {
		calls++; assert.equal(context.tools, undefined); assert.equal(context.messages.length, 1); assert.ok(options.signal); assert.equal(options.maxTokens, limits.maxTokens);
		throw new Error("Model request failed: confidential payload");
	} } as any;
	await assert.rejects(complete(h.ctx, { model: testModel, system: "test", input: "sample", limits, ledger, signal: new AbortController().signal }), /raw provider details were withheld/);
	assert.equal(calls, 1); assert.equal(ledger.calls, 1); assert.ok(ledger.chargedUsd > 0);
	const aborted = new AbortController(); aborted.abort();
	await assert.rejects(complete(h.ctx, { model: testModel, system: "test", input: "sample", limits, ledger, signal: aborted.signal }));
	assert.equal(calls, 1);
});
test("uncooperative providers time out without leaving the caller waiting", async () => {
	const h = harness("/tmp"), ledger = newLedger();
	h.ctx.modelRegistry = { complete: () => new Promise(() => {}) } as any;
	await assert.rejects(complete(h.ctx, { model: testModel, system: "test", input: "sample", limits: { ...limits, timeoutMs: 20 }, ledger, signal: new AbortController().signal }), /timed out/);
	assert.equal(ledger.calls, 1);
});
