import { StringEnum } from "@earendil-works/pi-ai";
import { BorderedLoader, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { resolve } from "node:path";
import { Type } from "typebox";
import { canonical, findProject } from "../lib/project.ts";
import { bounded, checked, findOnPath, formatRun, runBin } from "../lib/run.ts";
import { planSb, sbTimeoutMs, type SbParams } from "./args.ts";
import { getSbProject } from "./project.ts";
import { METHODOLOGY_SECTION, SB_TOOL_DESCRIPTION } from "./prompt.ts";
import { assertVerified, beginGates, finishGates, gateState, setGateState } from "./verification.ts";

const schema = Type.Object({
	op: StringEnum(["context", "gates", "gen", "derive", "audit", "init"] as const),
	lang: Type.Optional(StringEnum(["go", "ts"] as const)),
	regen: Type.Optional(Type.Boolean()), evidence: Type.Optional(Type.Boolean()),
	format: Type.Optional(StringEnum(["markdown", "json"] as const)),
});

export default function shenBackpressureExtension(pi: ExtensionAPI): void {
	pi.registerFlag("allow-sb-init", { description: "Explicitly allow SB initialization in headless sessions", type: "boolean", default: false });
	let commandAbort: AbortController | undefined;
	function widget(ctx: ExtensionContext, root?: string, error?: string) {
		if (ctx.hasUI) ctx.ui.setWidget("sb-status", root
			? [`SB gates: ${gateState(root).status}${error ? " — command failed" : ""}`]
			: error ? ["SB unconfigured/invalid — use /sb for diagnostics"] : undefined);
	}
	async function execute(params: SbParams, ctx: ExtensionContext, signal?: AbortSignal) {
		if (!ctx.isProjectTrusted()) throw new Error("Trust this project in Pi before reading or executing its SB configuration.");
		const bin = process.env.SB_BIN || findOnPath("sb");
		if (!bin) throw new Error("sb executable not found. Install pyrex41/Shen-Backpressure or set SB_BIN.");
		const plan = planSb(params);
		if (plan.kind === "error") throw new Error(plan.error);
		let root = ctx.cwd;
		if (params.op === "init") {
			if (findProject(root, "sb.toml")) throw new Error("SB already configured; init will not overwrite it.");
			if (!pi.getFlag("allow-sb-init") && (!ctx.hasUI || !await ctx.ui.confirm("Enable Shen-Backpressure?", `Scaffold SB configuration and support files in ${root}?`))) throw new Error("SB initialization requires user approval (headless: --allow-sb-init).");
		} else {
			const project = getSbProject(ctx.cwd);
			if (!project) throw new Error("SB is unconfigured: no sb.toml at the project root or an ancestor within this repository. Nested sketches are not activated automatically. Wire an explicit manifest; do not treat convention defaults as verification.");
			root = project.root;
		}
		try {
			const project = params.op === "init" ? undefined : getSbProject(root)!;
			const before = params.op === "gates" ? await beginGates(project!, signal) : undefined;
			if (params.op === "gen" || (params.op === "derive" && params.regen)) setGateState(root, { status: "stale" });
			const result = await runBin(bin, plan.argv, { cwd: root, signal, timeoutMs: sbTimeoutMs(params.op) });
			checked(result);
			if (before !== undefined) await finishGates(project!, before, signal);
			widget(ctx, root);
			return { content: [{ type: "text" as const, text: bounded(formatRun(result)) }], details: { op: params.op, ok: true, gates: gateState(root).status } };
		} catch (error) {
			if (params.op === "gates" && gateState(root).status !== "stale") setGateState(root, { status: "failed" });
			widget(ctx, root, String(error));
			throw error; // Pi requires throws, not an isError property in a successful return.
		}
	}

	pi.registerTool({
		name: "sb", label: "Shen-Backpressure", description: SB_TOOL_DESCRIPTION,
		promptSnippet: "Explicit SB context, generation and verification for configured projects.",
		promptGuidelines: ["Use sb op:gates for configured SB projects before completing tasks or committing; never initialize SB without user approval."],
		parameters: schema, executionMode: "sequential",
		execute: async (_id, params, signal, _update, ctx) => execute(params, ctx, signal),
		renderCall: (args, theme) => new Text(theme.fg("toolTitle", `sb ${args.op ?? ""}`), 0, 0),
		renderResult(result, { expanded }, theme, context) {
			const body = result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
			return new Text(theme.fg(context.isError ? "error" : "muted", expanded ? body : body.split("\n").slice(0, 8).join("\n")), 0, 0);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.isProjectTrusted()) return;
		try { const p = getSbProject(ctx.cwd); if (p) setGateState(p.root, { status: "unknown" }); widget(ctx, p?.root); }
		catch (error) { widget(ctx, undefined, String(error)); }
	});
	pi.on("session_shutdown", () => { commandAbort?.abort(); });
	pi.on("before_agent_start", (event, ctx) => {
		if (!ctx.isProjectTrusted() || !findProject(ctx.cwd, "sb.toml")) return;
		return { systemPrompt: `${event.systemPrompt}\n${METHODOLOGY_SECTION}` };
	});
	pi.on("tool_call", async (event, ctx) => {
		if (!ctx.isProjectTrusted()) return;
		const root = findProject(ctx.cwd, "sb.toml");
		if (!root) return;
		try {
			const project = getSbProject(ctx.cwd, false)!;
			if (event.toolName === "edit" || event.toolName === "write") {
				const path = event.input.path;
				if (typeof path === "string" && canonical(resolve(ctx.cwd, path.replace(/^@/, ""))) === canonical(project.output)) {
					return { block: true, reason: "Generated guard file is protected. Change the spec and run sb op:gen." };
				}
			}
			if (event.toolName === "todo" && ["done", "commit"].includes(String(event.input.op))) await assertVerified(ctx.cwd, ctx.signal);
		} catch (error) {
			// Invalid manifests must not silently disable the completion gate. Permit repairs and reads.
			if (event.toolName === "todo" && ["done", "commit"].includes(String(event.input.op))) return { block: true, reason: String(error) };
		}
	});
	pi.on("tool_result", (event, ctx) => {
		if (!["write", "edit", "bash"].includes(event.toolName)) return;
		const root = findProject(ctx.cwd, "sb.toml");
		if (root && gateState(root).status === "passed") { setGateState(root, { status: "stale" }); widget(ctx, root); }
	});

	for (const [name, op] of [["sb", "context"], ["sb-gates", "gates"]] as const) {
		pi.registerCommand(name, {
			description: op === "gates" ? "Run gates and retain the full bounded report" : "Show and retain SB context",
			handler: async (_args, ctx) => {
				await ctx.waitForIdle();
				if (commandAbort) { ctx.ui.notify("An SB command is already running; use /sb-cancel.", "warning"); return; }
				commandAbort = new AbortController();
				const controller = commandAbort;
				const work = async () => {
					try { return (await execute({ op }, ctx, controller.signal)).content[0]!.text; }
					catch (error) { return `sb ${op} failed: ${bounded(String(error))}`; }
				};
				try {
					let report: string;
					if (ctx.mode === "tui") {
						report = await ctx.ui.custom<string>((tui, theme, _kb, done) => {
							const loader = new BorderedLoader(tui, theme, `sb ${op} — Escape cancels`);
							loader.onAbort = () => controller.abort();
							void work().then(done);
							return loader;
						});
					} else report = await work();
					pi.sendMessage({ customType: "sb-report", content: report, display: true }, { triggerTurn: false });
				} finally { commandAbort = undefined; }
			},
		});
	}
	pi.registerCommand("sb-cancel", { description: "Cancel an active SB slash command", handler: async () => { commandAbort?.abort(); } });
}
