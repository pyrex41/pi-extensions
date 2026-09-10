import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findProject } from "../lib/project.ts";
import { bounded, checked, formatRun, runBin } from "../lib/run.ts";
import { TASK_MANAGEMENT_SECTION } from "./prompt.ts";
import { readClaims, saveClaims, withScudLock } from "./store.ts";
import { refreshScudWidget, registerTodoTool, resolveScudBin, scudInitialized } from "./todo.ts";

export default function scudExtension(pi: ExtensionAPI): void {
	registerTodoTool(pi, runBin, resolveScudBin);
	pi.on("session_start", async (_event, ctx) => { const bin = resolveScudBin(); if (bin) await refreshScudWidget(ctx, runBin, bin); });
	pi.on("session_tree", async (_event, ctx) => { const bin = resolveScudBin(); if (bin) await refreshScudWidget(ctx, runBin, bin); });
	pi.on("before_agent_start", (event, ctx) => {
		if (!ctx.isProjectTrusted() || !scudInitialized(ctx.cwd)) return;
		return { systemPrompt: `${event.systemPrompt}\n${TASK_MANAGEMENT_SECTION}` };
	});
	pi.registerCommand("todos", {
		description: "Show SCUD warmup and tasks in the transcript",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			try {
				if (!ctx.isProjectTrusted()) throw new Error("Trust the project before using SCUD.");
				const bin = resolveScudBin(), root = findProject(ctx.cwd, ".scud");
				if (!bin || !root) throw new Error("SCUD is not installed or this project has not opted in.");
				const body = await withScudLock(root, async () => {
					const reports: string[] = [];
					for (const op of ["warmup", "list"]) reports.push(formatRun(checked(await runBin(bin, ["-C", root, op], { cwd: root, timeoutMs: 15_000 }))));
					return reports.join("\n\n");
				});
				await refreshScudWidget(ctx, runBin, bin);
				pi.sendMessage({ customType: "scud-report", content: bounded(body), display: true }, { triggerTurn: false });
			} catch (error) { pi.sendMessage({ customType: "scud-report", content: bounded(String(error)), display: true }, { triggerTurn: false }); }
		},
	});
	pi.registerCommand("scud-release", {
		description: "Recover a session claim with confirmation: /scud-release TAG ID",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const parts = args.trim().split(/\s+/), [tag, id] = parts;
			if (!ctx.hasUI || !ctx.isProjectTrusted() || parts.length !== 2 || !tag || !id) {
				ctx.ui.notify("Recovery requires a trusted interactive/RPC session: /scud-release TAG ID", "error"); return;
			}
			const root = findProject(ctx.cwd, ".scud"), bin = resolveScudBin();
			if (!root || !bin) { ctx.ui.notify("SCUD not configured", "error"); return; }
			if (!await ctx.ui.confirm("Recover SCUD claim?", `Release ${tag}:${id} and reset an in-progress task to pending? Ensure its previous worker has stopped.`)) return;
			try {
				await withScudLock(root, async () => {
					const claims = await readClaims(root), key = `${tag}:${id}`;
					if (!claims[key]) throw new Error("No Pi claim to recover.");
					const result = checked(await runBin(bin, ["-C", root, "show", id, "--json", "-t", tag], { cwd: root, timeoutMs: 15_000 }));
					if (JSON.parse(result.stdout).status === "in-progress") checked(await runBin(bin, ["-C", root, "set-status", id, "pending", "-t", tag], { cwd: root, timeoutMs: 15_000 }));
					delete claims[key]; await saveClaims(root, claims);
				});
				await refreshScudWidget(ctx, runBin, bin);
				ctx.ui.notify(`Released ${tag}:${id}`, "info");
			} catch (error) { ctx.ui.notify(String(error), "error"); }
		},
	});
}
