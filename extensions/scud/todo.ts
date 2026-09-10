import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { findProject } from "../lib/project.ts";
import { bounded, checked, findOnPath, formatRun, type BinRunner } from "../lib/run.ts";
import { assertVerified } from "../shen-backpressure/verification.ts";
import { planScud } from "./args.ts";
import { TODO_TOOL_DESCRIPTION } from "./prompt.ts";
import { assertReady, initScud, readClaims, requireClaim, saveClaims, setDependencies, withScudLock } from "./store.ts";
import { TODO_OPS, type ScudTask, type TodoParams, type Warmup } from "./types.ts";
import { getTodoWidgetLines, parseWarmup } from "./widget.ts";

const schema = Type.Object({
	op: StringEnum(TODO_OPS), id: Type.Optional(Type.String()),
	title: Type.Optional(Type.String()), items: Type.Optional(Type.Array(Type.String())),
	status: Type.Optional(StringEnum(["pending", "in-progress", "done", "blocked", "failed", "review", "expanded", "deferred", "cancelled"] as const)),
	tag: Type.Optional(Type.String()), message: Type.Optional(Type.String()),
	priority: Type.Optional(StringEnum(["critical", "high", "medium", "low"] as const)),
	complexity: Type.Optional(Type.Integer({ minimum: 1 })),
	dependencies: Type.Optional(Type.Array(Type.String(), { description: "Replacement phase-local dependencies for op:dependencies" })),
});
export function scudInitialized(cwd: string): boolean { return !!findProject(cwd, ".scud"); }
export function resolveScudBin(): string | undefined { return process.env.SCUD_BIN || findOnPath("scud"); }

export async function refreshScudWidget(ctx: ExtensionContext, run: BinRunner, bin: string, signal?: AbortSignal): Promise<Warmup | undefined> {
	if (!ctx.hasUI || !ctx.isProjectTrusted()) return;
	const root = findProject(ctx.cwd, ".scud");
	if (!root) { ctx.ui.setWidget("todo-sidebar", undefined); return; }
	const result = await run(bin, ["-C", root, "warmup", "--json"], { cwd: root, signal, timeoutMs: 15_000 });
	const warmup = result.ok ? parseWarmup(result.stdout) : undefined;
	ctx.ui.setWidget("todo-sidebar", getTodoWidgetLines(warmup, true));
	return warmup;
}

export function registerTodoTool(pi: ExtensionAPI, run: BinRunner, resolveBin: () => string | undefined): void {
	pi.registerFlag("allow-scud-init", { description: "Explicitly allow SCUD initialization in headless sessions", type: "boolean", default: false });
	pi.registerTool({
		name: "todo", label: "SCUD", description: TODO_TOOL_DESCRIPTION,
		promptSnippet: "Manage an opted-in project's SCUD DAG with session-owned claims.",
		promptGuidelines: ["Use todo for multi-step work only in an initialized SCUD project. Do not initialize task scaffolding without user approval."],
		parameters: schema, executionMode: "sequential",
		async execute(_id, params: TodoParams, signal, _update, ctx) {
			if (!ctx.isProjectTrusted()) throw new Error("Trust this project in Pi before using its SCUD state.");
			const bin = resolveBin();
			if (!bin) throw new Error("scud executable not found. Install pyrex41/scud or set SCUD_BIN.");
			let root = findProject(ctx.cwd, ".scud");
			if (params.op === "init") {
				if (root) throw new Error("SCUD is already initialized; use append or tags instead.");
				if (!pi.getFlag("allow-scud-init") && (!ctx.hasUI || !await ctx.ui.confirm("Enable SCUD?", `Create project-local .scud task state in ${ctx.cwd}?`))) throw new Error("SCUD initialization requires user approval (headless: --allow-scud-init).");
				await initScud(ctx.cwd, bin, run, signal); root = ctx.cwd;
			}
			if (!root) throw new Error("SCUD is not initialized here. Only run init if the user wants SCUD enabled in this project.");
			const projectRoot = root;
			const session = ctx.sessionManager.getSessionId();
			const exec = async (argv: string[]) => checked(await run(bin, ["-C", projectRoot, ...argv], {
				cwd: projectRoot, signal, timeoutMs: 20_000, maxBytes: 8 * 1024 * 1024,
			}));
			const body = await withScudLock(projectRoot, async () => {
				const warmup = JSON.parse((await exec(["warmup", "--json"])).stdout) as Warmup;
				const claims = await readClaims(projectRoot);
				const owned = Object.keys(claims).filter(k => claims[k]?.session === session && k.endsWith(`:${params.id}`));
				const tag = params.tag ?? (owned.length === 1 ? owned[0]!.slice(0, owned[0]!.lastIndexOf(":")) : warmup.active_tag);
				if (["start", "done", "drop", "release", "dependencies", "commit"].includes(params.op)) {
					if (!params.id || !tag) throw new Error(`id and an explicit/resolved tag are required for ${params.op}`);
					const tasks = JSON.parse((await exec(["list", "--json", "-t", tag])).stdout) as ScudTask[];
					const task = tasks.find(t => t.id === params.id);
					if (!task) throw new Error(`Unknown task ${tag}:${params.id}`);
					const key = `${tag}:${params.id}`;
					if (params.op === "start") {
						if (claims[key]?.session === session && task.status === "in-progress") return `Already claimed ${key}`;
						if (claims[key]) throw new Error(`Task ${key} is claimed by another session. Use /scud-release for explicit recovery.`);
						assertReady(task, tasks);
						// Persist ownership before changing status. A crash leaves a recoverable claim, never a second owner.
						claims[key] = { session, at: new Date().toISOString() }; await saveClaims(projectRoot, claims);
						await exec(["set-status", params.id, "in-progress", "-t", tag]);
						return `Claimed ${key}: ${task.title}`;
					}
					if (params.op === "dependencies") {
						if (claims[key]) throw new Error("Cannot modify a claimed task's dependencies.");
						if (!params.dependencies) throw new Error("dependencies is required (use [] to clear).");
						await setDependencies(projectRoot, bin, run, tag, params.id, params.dependencies, signal);
						return `Updated dependencies for ${key}`;
					}
					await requireClaim(projectRoot, tag, params.id, session);
					if (task.status !== "in-progress") throw new Error(`Claimed task is ${task.status}; recover with /scud-release.`);
					if (params.op === "done" || params.op === "commit") await assertVerified(ctx.cwd, signal);
					if (params.op === "commit") {
						const result = checked(await run("git", ["commit", "-m", `[${key}] ${params.message ?? task.title}`], { cwd: projectRoot, signal, timeoutMs: 60_000 }));
						return formatRun(result);
					}
					const status = params.op === "done" ? "done" : params.op === "drop" ? "cancelled" : "pending";
					const result = await exec(["set-status", params.id, status, "-t", tag]);
					delete claims[key]; await saveClaims(projectRoot, claims);
					return formatRun(result);
				}
				const plan = planScud(params);
				if (plan.kind === "error") throw new Error(plan.error);
				const commands = params.op === "init" ? plan.commands.filter(c => c[0] !== "init") : plan.commands;
				const output: string[] = [];
				for (const argv of commands) output.push(formatRun(await exec(argv)));
				return output.join("\n\n");
			});
			await refreshScudWidget(ctx, run, bin, signal);
			return { content: [{ type: "text", text: bounded(body) }], details: { op: params.op, ok: true } };
		},
		renderCall: (args, theme) => new Text(theme.fg("toolTitle", `todo ${args.op ?? ""} ${args.id ?? ""}`), 0, 0),
		renderResult(result, { expanded }, theme, context) {
			const body = result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
			return new Text(theme.fg(context.isError ? "error" : "muted", expanded ? body : body.split("\n").slice(0, 8).join("\n")), 0, 0);
		},
	});
}
