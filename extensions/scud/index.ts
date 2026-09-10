import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runBin } from "../lib/run.ts";
import { TASK_MANAGEMENT_SECTION } from "./prompt.ts";
import { refreshScudWidget, registerTodoTool, resolveScudBin, scudInitialized } from "./todo.ts";

export default function scudExtension(pi: ExtensionAPI): void {
	registerTodoTool(pi, runBin, resolveScudBin);

	pi.on("session_start", async (_event, ctx) => {
		const bin = resolveScudBin();
		if (!bin) return;
		await refreshScudWidget(ctx, runBin, bin);
	});

	pi.on("session_tree", async (_event, ctx) => {
		const bin = resolveScudBin();
		if (!bin) return;
		await refreshScudWidget(ctx, runBin, bin);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!scudInitialized(ctx.cwd)) return;
		return { systemPrompt: `${event.systemPrompt}\n${TASK_MANAGEMENT_SECTION}` };
	});

	pi.registerCommand("todos", {
		description: "Show SCUD warmup and the current DAG todo list",
		handler: async (_args, ctx) => {
			const bin = resolveScudBin();
			if (!bin) {
				ctx.ui.notify("scud is not installed", "error");
				return;
			}
			const warmup = await runBin(bin, ["-C", ctx.cwd, "warmup"], { cwd: ctx.cwd, timeoutMs: 15_000 });
			const list = await runBin(bin, ["-C", ctx.cwd, "list"], { cwd: ctx.cwd, timeoutMs: 15_000 });
			await refreshScudWidget(ctx, runBin, bin);
			const body = [warmup.stdout, list.stdout].filter(Boolean).join("\n\n") || "No SCUD output.";
			if (ctx.hasUI) ctx.ui.notify(body.split("\n")[0] ?? "SCUD", warmup.ok ? "info" : "error");
			if (ctx.mode === "tui") {
				await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
					return {
						handleInput(data: string) {
							if (data === "\u001b" || data === "\u0003") done();
						},
						render(width: number) {
							const lines = ["", theme.fg("accent", " SCUD "), ""];
							for (const line of body.split("\n")) {
								lines.push(`  ${line}`.slice(0, Math.max(0, width)));
							}
							lines.push("", `  ${theme.fg("dim", "Press Escape to close")}`, "");
							return lines;
						},
					};
				});
			}
		},
	});
}
