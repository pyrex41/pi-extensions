import assert from "node:assert/strict";
import { test } from "node:test";
import { planSb, sbTimeoutMs } from "../extensions/shen-backpressure/args.ts";

test("context defaults to markdown", () => {
	assert.deepEqual(planSb({ op: "context" }), {
		kind: "argv",
		argv: ["context", "-format", "markdown"],
	});
});

test("context can request evidence json", () => {
	assert.deepEqual(planSb({ op: "context", format: "json", evidence: true }), {
		kind: "argv",
		argv: ["context", "-format", "json", "-evidence"],
	});
});

test("derive regen flag", () => {
	assert.deepEqual(planSb({ op: "derive", regen: true }), {
		kind: "argv",
		argv: ["derive", "-regen"],
	});
});

test("init skips claude skills and writes config", () => {
	assert.deepEqual(planSb({ op: "init", lang: "ts" }), {
		kind: "argv",
		argv: ["init", "-config", "-no-skills", "-lang", "ts"],
	});
});

test("gates get a long timeout", () => {
	assert.ok(sbTimeoutMs("gates") >= 600_000);
	assert.ok(sbTimeoutMs("context") < 60_000);
});
