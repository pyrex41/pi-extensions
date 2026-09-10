import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, ROLES, type Role } from "../workbench/config.ts";
import { complete, emptyUsage, modelRef, newLedger, resolveModel, safeText, usageDelta } from "../workbench/inference.ts";
import { ARTIFACT_CONTRACT, executeGraph, recipe, runReport, validateGraph, type Node, type Run } from "./engine.ts";

const nodeSchema = Type.Object({ id: Type.String(), role: StringEnum(["planner", "reviewer", "skeptic", "synthesizer"] as const), instructions: Type.String({ maxLength: 4000 }), dependsOn: Type.Array(Type.String()) });
const schema = Type.Object({ op: StringEnum(["run", "status", "resume", "cancel"] as const), id: Type.Optional(Type.String()), recipe: Type.Optional(StringEnum(["plan", "review", "synthesize"] as const)), goal: Type.Optional(Type.String({ maxLength: 4000 })), context: Type.Optional(Type.String({ maxLength: 32_000 })), nodes: Type.Optional(Type.Array(nodeSchema, { minItems: 1, maxItems: 12 })), background: Type.Optional(Type.Boolean()) });

export default function workflowExtension(pi: ExtensionAPI): void {
	pi.registerFlag("allow-workflow", { type: "boolean", default: false, description: "Explicitly authorize tool-less workflow model calls in headless sessions" });
	const runs = new Map<string, Run>(), active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
	let routes: Partial<Record<Role, string>> = {}, generation = 0, sequence = 0;
	let authorizing: symbol | undefined;
	const widget = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const run = [...runs.values()].at(-1);
		ctx.ui.setWidget("workflows", run ? [`Workflow ${run.id} · ${run.status} · ${run.steps.filter(s => s.status === "complete").length}/${run.steps.length} · $${run.ledger.chargedUsd.toFixed(3)} reserved`] : undefined);
	};
	function restore(ctx: ExtensionContext) {
		generation++; authorizing = undefined; for (const job of active.values()) job.controller.abort(); active.clear(); runs.clear(); routes = {};
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom") continue;
			if (entry.customType === "workbench-routes") routes = structuredClone(entry.data) as typeof routes;
			if (entry.customType !== "workbench-run") continue;
			try {
				const run = structuredClone(entry.data) as Run; validateGraph(run.steps);
				if (!run.id || !run.ledger || !Number.isFinite(run.ledger.chargedUsd) || run.ledger.chargedUsd < 0 || !Number.isInteger(run.ledger.calls) || run.ledger.calls < 0) continue;
				if (run.status === "running") run.status = "cancelled";
				runs.set(run.id, run);
			} catch { /* invalid/old checkpoints are not execution authority */ }
		}
		while (runs.size > 10) runs.delete(runs.keys().next().value!);
		widget(ctx);
	}
	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("session_shutdown", () => { generation++; for (const job of active.values()) job.controller.abort(); active.clear(); });

	type LaunchOptions = { goal?: string; context?: string; recipe?: string; nodes?: Node[]; id?: string };
	async function launch(ctx: ExtensionContext, options: LaunchOptions, signal?: AbortSignal): Promise<{ run: Run; promise: Promise<void> }> {
		if (active.size || authorizing) throw new Error("A workflow is already running or awaiting approval in this session.");
		const token = Symbol(); authorizing = token;
		try { return await launchImpl(ctx, options, signal); }
		finally { if (authorizing === token) authorizing = undefined; }
	}
	async function launchImpl(ctx: ExtensionContext, options: LaunchOptions, signal?: AbortSignal): Promise<{ run: Run; promise: Promise<void> }> {
		const requestedGeneration = generation;
		if (!ctx.isProjectTrusted()) throw new Error("Trust this project before using model workflows.");
		if (active.size) throw new Error("A workflow is already running in this session. Inspect or cancel it first.");
		const config = loadConfig(ctx);
		let run = options.id ? runs.get(options.id) : undefined;
		if (options.id && !run) throw new Error("Unknown workflow ID in this session branch");
		if (run?.status === "complete") throw new Error("Workflow is already complete; no rerun needed.");
		const steps = run?.steps ?? (options.nodes ?? recipe(options.recipe ?? "review")).map(n => ({ ...n, instructions: safeText(n.instructions, 4000), status: "pending" as const }));
		validateGraph(steps);
		const models: Partial<Record<Role, string>> = run?.models ?? { ...config.roles, ...routes };
		for (const role of new Set(steps.map(n => n.role))) models[role] = modelRef(resolveModel(ctx, models[role]));
		const goal = run?.goal ?? safeText(options.goal ?? "", 4000), context = run?.context ?? safeText(options.context ?? "", 24_000);
		if (!goal.trim()) throw new Error("A workflow requires an explicit goal.");
		const allowed = pi.getFlag("allow-workflow") || (ctx.hasUI && await ctx.ui.confirm("Run advisory model workflow?", `${steps.length} tool-less stages using ${[...new Set(steps.map(n => models[n.role]))].join(", ")}.\nShares the supplied goal and evidence (${Buffer.byteLength(goal + context)} bytes), not the repository or full transcript. Review sensitive content before approving.\nUp to ${config.workflow.maxCalls} calls per run; $${config.workflow.maxEstimatedCostUsd} catalog-price admission budget (not a billing guarantee).`));
		if (!allowed) throw new Error("Workflow model calls require explicit approval (headless: --allow-workflow).");
		if (requestedGeneration !== generation) throw new Error("Session changed during workflow approval; request again in the current session.");
		signal?.throwIfAborted();
		if (!run) { run = { id: `flow-${Date.now().toString(36)}-${++sequence}`, goal, context, steps, models, ledger: newLedger(), status: "running", createdAt: Date.now() }; runs.set(run.id, run); }
		const current = run, epoch = generation, controller = new AbortController();
		const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
		const checkpoint = () => { if (epoch !== generation) return; pi.appendEntry("workbench-run", structuredClone(current)); widget(ctx); };
		const promise = executeGraph(current, config.workflow.concurrency, async (node, input, childSignal) => {
			const text = await complete(ctx, { model: resolveModel(ctx, current.models[node.role]), system: `${ARTIFACT_CONTRACT}\nRole: ${node.role}. ${node.instructions}`, input, limits: config.workflow, ledger: current.ledger, signal: childSignal });
			return text;
		}, controller, checkpoint).catch(() => {
			current.status = controller.signal.aborted ? "cancelled" : "failed"; current.error = "Workflow execution failed; inspect completed stages before resuming."; checkpoint();
		}).finally(() => {
			signal?.removeEventListener("abort", abort);
			if (epoch !== generation) return;
			active.delete(current.id); widget(ctx);
			pi.sendMessage({ customType: "workflow-report", content: runReport(current), display: true }, { triggerTurn: false });
		});
		active.set(current.id, { controller, promise });
		while (runs.size > 10) { const first = runs.keys().next().value!; if (active.has(first)) break; runs.delete(first); }
		return { run: current, promise };
	}
	function takeUsage(run?: Run) {
		if (!run) return undefined;
		const total = run.ledger.usage ?? emptyUsage(), delta = usageDelta(total, run.reportedUsage);
		run.reportedUsage = structuredClone(total);
		pi.appendEntry("workbench-run", structuredClone(run));
		return delta;
	}
	function status(id?: string): string {
		if (id) { const run = runs.get(id); if (!run) throw new Error("Unknown workflow ID"); return runReport(run); }
		return [...runs.values()].map(r => `${r.id}: ${r.status}, ${r.steps.filter(n => n.status === "complete").length}/${r.steps.length}, $${r.ledger.chargedUsd.toFixed(4)} reserved`).join("\n") || "No workflow runs in this session branch.";
	}
	pi.registerTool({ name: "workflow", label: "Workflow", description: "Model-independent, tool-less advisory workflows. run: goal + scoped context; recipe plan/review/synthesize or a validated data-only nodes DAG. Optional background returns a run ID. status/cancel/resume use that ID. Runs require explicit user consent or --allow-workflow. Never sends repository/full transcript automatically. Results are advisory—not code execution, tests, SB gates or task completion. Completed nodes are cached on resume; budget charges persist. Never use workflow nodes as a parallel SCUD backlog.",
		promptSnippet: "Run approved model-routed advisory workflows; inspect or cancel background analyses.", parameters: schema,
		async execute(_call, params, signal, _update, ctx) {
			if (params.op === "status") return { content: [{ type: "text", text: status(params.id) }], details: {}, usage: params.id ? takeUsage(runs.get(params.id)) : undefined };
			if (params.op === "cancel") { if (!params.id || !active.has(params.id)) throw new Error("No running workflow with that ID"); active.get(params.id)!.controller.abort(); return { content: [{ type: "text", text: "Cancellation requested; completed analysis artifacts remain available." }], details: {} }; }
			if (params.op === "resume" && !params.id) throw new Error("id is required for resume");
			const job = await launch(ctx, { ...params, id: params.op === "resume" ? params.id : undefined }, signal);
			if (!params.background) {
				await job.promise;
				if (job.run.status !== "complete") throw new Error(runReport(job.run));
			}
			return { content: [{ type: "text", text: params.background ? `Started ${job.run.id}. Use workflow status/cancel; no automatic primary-agent turn will be triggered.` : runReport(job.run) }], details: { id: job.run.id, status: job.run.status, ledger: structuredClone(job.run.ledger) }, usage: params.background ? undefined : takeUsage(job.run) };
		},
	});
	pi.registerCommand("workflow", { description: "Advisory workflows: models | route ROLE PROVIDER/MODEL | run RECIPE GOAL | status [ID] | resume ID | cancel ID", handler: async (args, ctx) => {
		const [op, first, ...rest] = args.trim().split(/\s+/);
		try {
			if (op === "models") { ctx.ui.notify(ctx.modelRegistry.getAvailable().map(modelRef).join("\n"), "info"); return; }
			if (op === "route") {
				if (!ROLES.includes(first as Role) || first === "observer" || rest.length !== 1) throw new Error("Use /workflow route planner|reviewer|skeptic|synthesizer PROVIDER/MODEL");
				routes[first as Role] = modelRef(resolveModel(ctx, rest[0])); pi.appendEntry("workbench-routes", { ...routes }); ctx.ui.notify(`Routed ${first} to ${routes[first as Role]}`, "info"); return;
			}
			if (op === "run" || op === "resume") { await launch(ctx, op === "resume" ? { id: first } : { recipe: first, goal: rest.join(" ") }); return; }
			if (op === "cancel") { if (!first || !active.has(first)) throw new Error("No running workflow with that ID"); active.get(first)!.controller.abort(); return; }
			pi.sendMessage({ customType: "workflow-report", content: (op === "status" ? status(first) : "Usage: /workflow models | route ROLE PROVIDER/MODEL | run plan|review|synthesize GOAL | status [ID] | resume ID | cancel ID\nFor code review, use the workflow tool with explicitly supplied evidence; commands do not read your repository."), display: true }, { triggerTurn: false });
		} catch (error) { ctx.ui.notify(safeText(error instanceof Error ? error.message : "Workflow command failed", 1000), "error"); }
	} });
}
