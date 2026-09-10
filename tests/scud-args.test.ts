import assert from "node:assert/strict";
import { test } from "node:test";
import { planScud } from "../extensions/scud/args.ts";

test("warmup is json", () => {
	const plan = planScud({ op: "warmup" });
	assert.deepEqual(plan, { kind: "commands", commands: [["warmup", "--json"]] });
});

test("start/done/drop map to set-status", () => {
	assert.deepEqual(planScud({ op: "start", id: "1.2" }), {
		kind: "commands",
		commands: [["set-status", "1.2", "in-progress"]],
	});
	assert.deepEqual(planScud({ op: "done", id: "1.2", tag: "core" }), {
		kind: "commands",
		commands: [["set-status", "1.2", "done", "-t", "core"]],
	});
	assert.deepEqual(planScud({ op: "drop", id: "3" }), {
		kind: "commands",
		commands: [["set-status", "3", "cancelled"]],
	});
});

test("start without id is an error", () => {
	const plan = planScud({ op: "start" });
	assert.equal(plan.kind, "error");
});

test("append fans out create commands", () => {
	const plan = planScud({
		op: "append",
		items: ["Write guards", "Wire gates"],
		priority: "high",
		complexity: 5,
		tag: "core",
	});
	assert.deepEqual(plan, {
		kind: "commands",
		commands: [
			["create", "--title", "Write guards", "-t", "core", "--priority", "high", "--complexity", "5"],
			["create", "--title", "Wire gates", "-t", "core", "--priority", "high", "--complexity", "5"],
		],
	});
});

test("init sets an active tag then optionally creates titles", () => {
	const plan = planScud({ op: "init", items: ["Scaffold", "Prove"] });
	assert.deepEqual(plan, {
		kind: "commands",
		commands: [
			["init"],
			["tags", "main"],
			["create", "--title", "Scaffold", "-t", "main"],
			["create", "--title", "Prove", "-t", "main"],
		],
	});
});

test("list can filter status and tag", () => {
	const plan = planScud({ op: "list", status: "pending", tag: "core" });
	assert.deepEqual(plan, {
		kind: "commands",
		commands: [["list", "--json", "-t", "core", "-s", "pending"]],
	});
});

test("commit passes -m when set", () => {
	assert.deepEqual(planScud({ op: "commit", message: "ship it" }), {
		kind: "commands",
		commands: [["commit", "-m", "ship it"]],
	});
});
