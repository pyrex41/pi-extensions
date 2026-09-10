import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { findOnPath, formatRun, missingBinMessage, type BinRunner, type RunResult } from "../lib/run.ts";
import { planScud } from "./args.ts";
import { TODO_TOOL_DESCRIPTION } from "./prompt.ts";
import type { TodoDetails, TodoOp, TodoParams, Warmup } from "./types.ts";
import { formatTaskList, getTodoWidgetLines, parseTaskList, parseWarmup } from "./widget.ts";

const TodoParamsSchema = Type.Object({
	op: StringEnum([
		"init",
		"warmup",
		"next",
		"list",
		"show",
		"start",
		"done",
		"drop",
		"append",
		"stats",
		"waves",
		"commit",
		"tags",
	] as const),
	id: Type.Optional(Type.String({ description: "SCUD task id, e.g. 1.2" })),
	title: Type.Optional(Type.String({ description: "Task title for append" })),
	items: Type.Optional(Type.Array(Type.String(), { description: "Titles for init/append" })),
	status: Type.Optional(Type.String({ description: "Filter for list" })),
	tag: Type.Optional(Type.String({ description: "Phase tag" })),
	message: Type.Optional(Type.String({ description: "Commit message" })),
	priority: Type.Optional(Type.String({ description: "critical, high, medium, low" })),
	complexity: Type.Optional(Type.Number({ description: "Fibonacci complexity" })),
});

export function scudInitialized(cwd: string): boolean {
	return existsSync(join(cwd, ".scud"));
}

export async function refreshScudWidget(
	ctx: ExtensionContext,
	run: BinRunner,
	bin: string,
): Promise<Warmup | undefined> {
	const initialized = scudInitialized(ctx.cwd);
	if (!initialized) {
		ctx.ui.setWidget("todo-sidebar", getTodoWidgetLines(undefined, false));
		return undefined;
	}
	const result = await run(bin, ["-C", ctx.cwd, "warmup", "--json"], { cwd: ctx.cwd, timeoutMs: 15_000 });
	const warmup = result.ok ? parseWarmup(result.stdout) : undefined;
	ctx.ui.setWidget("todo-sidebar", getTodoWidgetLines(warmup, true));
	return warmup;
}

export function registerTodoTool(pi: ExtensionAPI, run: BinRunner, resolveBin: () => string | undefined): void {
	pi.registerTool({
		name: "todo",
		label: "SCUD",
		description: TODO_TOOL_DESCRIPTION,
		promptSnippet: "SCUD DAG todos: warmup/next/start/done against .scud/, reference tasks by id.",
		promptGuidelines: [
			"Use the todo tool (SCUD) for multi-step work. Reference tasks by SCUD id, not by guessed names.",
			"Batch todo start/done with the real work; do not spend a turn only updating todos.",
			"Call todo op:next when the next unblocked task is uncertain; do not invent a parallel checklist.",
		],
		parameters: TodoParamsSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params: TodoParams, signal, onUpdate, ctx) {
			const bin = resolveBin();
			if (!bin) {
				const error = missingBinMessage(
					"scud",
					"Install from https://github.com/pyrex41/scud (binary to ~/.local/bin).",
				);
				return errorResult(params.op, error);
			}

			const plan = planScud(params);
			if (plan.kind === "error") return errorResult(params.op, plan.error);

			const outputs: string[] = [];
			let last: RunResult | undefined;
			for (const argv of plan.commands) {
				onUpdate?.({ content: [{ type: "text", text: `scud ${argv.join(" ")}` }] });
				last = await run(bin, ["-C", ctx.cwd, ...argv], {
					cwd: ctx.cwd,
					signal,
					timeoutMs: params.op === "commit" ? 60_000 : 20_000,
				});
				outputs.push(formatRun(last));
				if (!last.ok) {
					await refreshScudWidget(ctx, run, bin);
					return errorResult(params.op, outputs.join("\n\n"), last);
				}
			}

			const warmup = await refreshScudWidget(ctx, run, bin);
			const combined = outputs.filter(Boolean).join("\n\n");
			const details: TodoDetails = {
				op: params.op,
				ok: true,
				tag: params.tag ?? warmup?.active_tag,
				warmup,
			};

			if (params.op === "warmup" && last) {
				const parsed = parseWarmup(last.stdout);
				if (parsed) details.warmup = parsed;
			}
			if (params.op === "list" && last) {
				details.tasks = parseTaskList(last.stdout);
			}

			const text =
				params.op === "list" && details.tasks
					? formatTaskList(details.tasks)
					: combined || "ok";

			return {
				content: [{ type: "text", text }],
				details,
			};
		},
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.op);
			if (args.id) text += ` ${theme.fg("accent", args.id)}`;
			if (args.title) text += ` ${theme.fg("dim", `"${args.title}"`)}`;
			if (args.tag) text += ` ${theme.fg("muted", `@${args.tag}`)}`;
			return new Text(text, 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as TodoDetails | undefined;
			if (details?.error) return new Text(theme.fg("error", details.error), 0, 0);
			const text = result.content[0];
			const body = text?.type === "text" ? text.text : "";
			return new Text(theme.fg("muted", body), 0, 0);
		},
	});
}

function errorResult(op: TodoOp, error: string, last?: RunResult) {
	const details: TodoDetails = { op, ok: false, error };
	return {
		content: [{ type: "text", text: error }],
		details,
		isError: true as const,
		...(last && !last.ok ? {} : {}),
	};
}

export function resolveScudBin(): string | undefined {
	return process.env.SCUD_BIN || findOnPath("scud");
}
