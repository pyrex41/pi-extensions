import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTaskList, getTodoWidgetLines, parseWarmup } from "../extensions/scud/widget.ts";

test("parseWarmup reads scud warmup --json", () => {
	const warmup = parseWarmup(`{
  "active_tag": "core",
  "stats": { "total": 10, "done": 3, "pending": 6, "in_progress": 1 },
  "next_task": { "id": "1.2", "title": "Emit guards", "priority": "high", "complexity": 5 }
}`);
	assert.equal(warmup?.active_tag, "core");
	assert.equal(warmup?.next_task?.id, "1.2");
});

test("widget shows init hint when missing .scud", () => {
	const lines = getTodoWidgetLines(undefined, false);
	assert.match(lines[0] ?? "", /not initialized/);
});

test("widget summarizes next ready task", () => {
	const lines = getTodoWidgetLines(
		{
			active_tag: "core",
			stats: { total: 10, done: 3, pending: 6, in_progress: 1 },
			next_task: { id: "1.2", title: "Emit guards", priority: "high", complexity: 5 },
		},
		true,
	);
	assert.match(lines[0] ?? "", /core/);
	assert.match(lines[0] ?? "", /3\/10/);
	assert.match(lines[1] ?? "", /1\.2/);
	assert.match(lines[1] ?? "", /Emit guards/);
});

test("formatTaskList uses status markers", () => {
	const text = formatTaskList([
		{ id: "1", title: "Spec", status: "done" },
		{ id: "2", title: "Guards", status: "in-progress" },
		{ id: "3", title: "Gates", status: "pending" },
	]);
	assert.match(text, /✓ 1/);
	assert.match(text, /● 2/);
	assert.match(text, /○ 3/);
});
