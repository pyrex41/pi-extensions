import assert from "node:assert/strict";
import { test } from "node:test";
import { executeGraph, parseArtifact, recipe, validateGraph, type Node, type Run } from "../extensions/workflows/engine.ts";
import workflowExtension from "../extensions/workflows/index.ts";
import { newLedger } from "../extensions/workbench/inference.ts";
import { harness } from "./harness.ts";
import { artifact, response, testModel } from "./workbench-fixtures.ts";

function run(nodes: Node[]): Run { return { id: "test", goal: "Analyze supplied test evidence", context: "explicit evidence", status: "running", steps: nodes.map(n => ({ ...n, status: "pending" })), ledger: newLedger(), models: {}, createdAt: 0 }; }
test("workflow graphs reject cycles, missing refs, duplicate IDs and observer roles", () => {
	const nodes = recipe("plan"); validateGraph(nodes);
	assert.throws(() => validateGraph([...nodes, nodes[0]!]));
	assert.throws(() => validateGraph([{ ...nodes[0]!, dependsOn: ["missing"] }]));
	assert.throws(() => validateGraph([{ ...nodes[0]!, dependsOn: ["draft"] }]), /cycle/);
	assert.throws(() => validateGraph([{ ...nodes[0]!, role: "observer" }]));
	assert.throws(() => parseArtifact('{"summary":"green"}'), /schema/);
});
test("dependency-ready stages pipeline without waiting for an unrelated slow sibling", async () => {
	const nodes: Node[] = [{ id: "a", role: "reviewer", instructions: "A", dependsOn: [] }, { id: "b", role: "reviewer", instructions: "B", dependsOn: [] }, { id: "c", role: "synthesizer", instructions: "C", dependsOn: ["a"] }];
	const r = run(nodes), order: string[] = []; let release!: (s: string) => void;
	await executeGraph(r, 2, async node => {
		order.push(node.id);
		if (node.id === "b") return new Promise<string>(resolve => { release = resolve; });
		if (node.id === "c") release(artifact);
		return artifact;
	}, new AbortController(), () => {});
	assert.deepEqual(order, ["a", "b", "c"]); assert.equal(r.status, "complete");
});
test("failed workflows retain completed nodes and resume only unfinished work", async () => {
	const r = run(recipe("plan")), counts = new Map<string, number>(); let fail = true;
	const execute = async (n: Node) => { counts.set(n.id, (counts.get(n.id) ?? 0) + 1); if (n.id === "challenge" && fail) return "bad output"; return artifact; };
	await executeGraph(r, 2, execute, new AbortController(), () => {});
	assert.equal(r.status, "failed"); assert.equal(r.steps[0]!.status, "complete"); assert.equal(r.steps[2]!.status, "pending");
	fail = false; await executeGraph(r, 2, execute, new AbortController(), () => {});
	assert.equal(r.status, "complete"); assert.equal(counts.get("draft"), 1); assert.equal(counts.get("challenge"), 2);
});
test("workflow tool routes arbitrary models, persists checkpoints, and returns real failure errors", async () => {
	const h = harness("/tmp"); let calls = 0, bad = false;
	h.ctx.model = testModel;
	h.ctx.modelRegistry = { find: () => testModel, hasConfiguredAuth: () => true, complete: async (model: any, context: any) => { calls++; assert.equal(model.provider, "test-vendor"); assert.ok(context.messages[0].content[0].text.includes("scoped evidence")); return response(bad ? "bad output" : artifact); } } as any;
	workflowExtension(h.api); await h.event("session_start");
	const result = await h.call("workflow", { op: "run", recipe: "plan", goal: "Test planning", context: "scoped evidence" });
	assert.equal((result.details as { status: string }).status, "complete"); assert.equal(calls, 3);
	assert.equal(result.usage?.input, 150);
	const id = (result.details as { id: string }).id;
	const polled = await h.call("workflow", { op: "status", id });
	assert.equal(polled.usage?.input, 0, "status must not double-count prior nested usage");
	assert.ok(h.entries.some(e => e.customType === "workbench-run"));
	bad = true;
	await assert.rejects(h.call("workflow", { op: "run", recipe: "plan", goal: "Test failure", context: "scoped evidence" }), /failed/);
	await h.event("session_shutdown");
});
test("workflow spending requires consent and approval races admit only one run", async () => {
	const h = harness("/tmp"); let calls = 0, approve!: (v: boolean) => void;
	h.ctx.model = testModel;
	h.ctx.modelRegistry = { find: () => testModel, hasConfiguredAuth: () => true, complete: async () => { calls++; return response(artifact); } } as any;
	workflowExtension(h.api); await h.event("session_start");
	h.ctx.ui.confirm = async () => false;
	await assert.rejects(h.call("workflow", { op: "run", goal: "Check", recipe: "plan" }), /approval/); assert.equal(calls, 0);
	h.ctx.ui.confirm = async () => new Promise<boolean>(resolve => { approve = resolve; });
	const first = h.call("workflow", { op: "run", goal: "Check", recipe: "plan" });
	await assert.rejects(h.call("workflow", { op: "run", goal: "Check", recipe: "plan" }), /awaiting approval/);
	approve(true); await first; assert.equal(calls, 3);
});
test("a branch change during approval prevents stale-session execution", async () => {
	const h = harness("/tmp"); let approve!: (v: boolean) => void, calls = 0;
	h.ctx.model = testModel;
	h.ctx.modelRegistry = { find: () => testModel, hasConfiguredAuth: () => true, complete: async () => { calls++; return response(artifact); } } as any;
	h.ctx.ui.confirm = async () => new Promise<boolean>(resolve => { approve = resolve; });
	workflowExtension(h.api); await h.event("session_start");
	const pending = h.call("workflow", { op: "run", goal: "Check", recipe: "plan" });
	await h.event("session_tree"); approve(true);
	await assert.rejects(pending, /Session changed/); assert.equal(calls, 0);
});
