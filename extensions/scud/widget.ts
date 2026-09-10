import type { ScudTask, Warmup } from "./types.ts";

const MARKER: Record<string, string> = {
	pending: "○",
	"in-progress": "●",
	done: "✓",
	blocked: "■",
	failed: "!",
	review: "R",
	expanded: "X",
	deferred: "…",
	cancelled: "✗",
};

export function parseWarmup(stdout: string): Warmup | undefined {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("{")) return undefined;
	try {
		return JSON.parse(trimmed) as Warmup;
	} catch {
		return undefined;
	}
}

export function parseTaskList(stdout: string): ScudTask[] | undefined {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("[")) return undefined;
	try {
		const value = JSON.parse(trimmed) as unknown;
		if (!Array.isArray(value)) return undefined;
		return value as ScudTask[];
	} catch {
		return undefined;
	}
}

export function getTodoWidgetLines(warmup: Warmup | undefined, initialized: boolean): string[] {
	if (!initialized) {
		return ["SCUD  not initialized", "todo op:init to start a DAG"];
	}
	if (!warmup) {
		return ["SCUD  (warmup unavailable)"];
	}

	const tag = warmup.active_tag || "(no tag)";
	const stats = warmup.stats;
	const summary = stats
		? `${stats.done}/${stats.total} done  ${stats.in_progress} active  ${stats.pending} pending`
		: "no stats";
	const lines = [`SCUD  ${tag}  ${summary}`];

	if (warmup.next_task) {
		const t = warmup.next_task;
		const extra = [t.priority, t.complexity !== undefined ? `c${t.complexity}` : undefined]
			.filter(Boolean)
			.join(" ");
		lines.push(`next  ${t.id}  ${t.title}${extra ? `  ${extra}` : ""}`);
	} else {
		lines.push("next  none ready");
	}

	return lines;
}

export function formatTaskLine(task: ScudTask): string {
	const mark = MARKER[task.status] ?? "?";
	return `${mark} ${task.id} [${task.status}] ${task.title}`;
}

export function formatTaskList(tasks: ScudTask[]): string {
	if (tasks.length === 0) return "No tasks.";
	return tasks.map(formatTaskLine).join("\n");
}
