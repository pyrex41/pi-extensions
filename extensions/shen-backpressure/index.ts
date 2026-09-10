import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { findOnPath, formatRun, missingBinMessage, runBin } from "../lib/run.ts";
import { planSb, sbTimeoutMs, type SbParams } from "./args.ts";
import { METHODOLOGY_SECTION, SB_TOOL_DESCRIPTION } from "./prompt.ts";

const SbParamsSchema = Type.Object({
	op: StringEnum(["context", "gates", "gen", "derive", "audit", "init"] as const),
	lang: Type.Optional(Type.String({ description: "go or ts, for init" })),
	regen: Type.Optional(Type.Boolean({ description: "sb derive -regen" })),
	evidence: Type.Optional(Type.Boolean({ description: "sb context -evidence" })),
	format: Type.Optional(Type.String({ description: "markdown or json" })),
});

function resolveSbBin(): string | undefined {
	return process.env.SB_BIN || findOnPath("sb");
}

function sbConfigured(cwd: string): boolean {
	return existsSync(join(cwd, "sb.toml"));
}

function widgetLines(status: string): string[] {
	return [`SB  ${status}`];
}

async function latestContext(cwd: string, signal?: AbortSignal): Promise<string | undefined> {
	const bin = resolveSbBin();
	if (!bin || !sbConfigured(cwd)) return undefined;
	const result = await runBin(bin, ["context", "-format", "markdown"], {
		cwd,
		signal,
		timeoutMs: 20_000,
	});
	if (!result.ok) return result.stderr || result.stdout || result.error;
	return result.stdout;
}

export default function shenBackpressureExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "sb",
		label: "Shen-Backpressure",
		description: SB_TOOL_DESCRIPTION,
		promptSnippet: "Run Shen-Backpressure context/gates/gen/derive via the sb CLI.",
		promptGuidelines: [
			"Use the sb tool after changing specs/core.shen or guard-consuming code: op:gates, not ad-hoc test commands.",
			"Use sb op:context when you need constructor names, the proof chain, or the latest backpressure failure.",
			"Never edit generated guard files; change specs/core.shen and call sb op:gen.",
		],
		parameters: SbParamsSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params: SbParams, signal, onUpdate, ctx) {
			const bin = resolveSbBin();
			if (!bin) {
				const error = missingBinMessage(
					"sb",
					"Install from https://github.com/pyrex41/Shen-Backpressure (`go install` the sb CLI).",
				);
				return { content: [{ type: "text", text: error }], details: { op: params.op, ok: false, error }, isError: true };
			}

			const plan = planSb(params);
			if (plan.kind === "error") {
				return {
					content: [{ type: "text", text: plan.error }],
					details: { op: params.op, ok: false, error: plan.error },
					isError: true,
				};
			}

			onUpdate?.({ content: [{ type: "text", text: `sb ${plan.argv.join(" ")}` }] });
			const result = await runBin(bin, plan.argv, {
				cwd: ctx.cwd,
				signal,
				timeoutMs: sbTimeoutMs(params.op),
			});
			const text = formatRun(result) || (result.ok ? "ok" : `exit ${result.code}`);
			ctx.ui.setWidget("sb-status", widgetLines(result.ok ? `${params.op} ok` : `${params.op} FAIL`));
			if (ctx.hasUI && !result.ok) ctx.ui.notify(`sb ${params.op} failed`, "error");
			return {
				content: [{ type: "text", text }],
				details: { op: params.op, ok: result.ok, code: result.code },
				...(result.ok ? {} : { isError: true }),
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("sb ")) + theme.fg("muted", args.op), 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as { ok?: boolean } | undefined;
			const text = result.content[0];
			const body = text?.type === "text" ? text.text : "";
			const color = details?.ok === false ? "error" : "muted";
			return new Text(theme.fg(color, body), 0, 0);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!sbConfigured(ctx.cwd)) {
			ctx.ui.setWidget("sb-status", widgetLines("no sb.toml"));
			return;
		}
		ctx.ui.setWidget("sb-status", widgetLines("project armed"));
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!sbConfigured(ctx.cwd)) return;
		const live = await latestContext(ctx.cwd, ctx.signal);
		const block = live
			? `${METHODOLOGY_SECTION}\n## Live Project Context\n\n${live}`
			: METHODOLOGY_SECTION;
		return { systemPrompt: `${event.systemPrompt}\n${block}` };
	});

	pi.registerCommand("sb", {
		description: "Show Shen-Backpressure project context",
		handler: async (_args, ctx) => {
			await runSbCommand(ctx, ["context", "-format", "markdown"]);
		},
	});

	pi.registerCommand("sb-gates", {
		description: "Run Shen-Backpressure verification gates",
		handler: async (_args, ctx) => {
			await runSbCommand(ctx, ["gates"]);
		},
	});
}

async function runSbCommand(ctx: ExtensionContext, argv: string[]): Promise<void> {
	const bin = resolveSbBin();
	if (!bin) {
		ctx.ui.notify("sb is not installed", "error");
		return;
	}
	ctx.ui.setStatus("sb", `sb ${argv[0]}…`);
	const result = await runBin(bin, argv, { cwd: ctx.cwd, timeoutMs: sbTimeoutMs(argv[0] === "gates" ? "gates" : "context") });
	ctx.ui.setStatus("sb", "");
	ctx.ui.setWidget("sb-status", widgetLines(result.ok ? `${argv[0]} ok` : `${argv[0]} FAIL`));
	const preview = (result.stdout || result.stderr || result.error || "").split("\n")[0];
	ctx.ui.notify(preview || `sb ${argv[0]}`, result.ok ? "info" : "error");
}
