import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { defaults, loadConfig } from "../workbench/config.ts";
import { complete, modelRef, newLedger, resolveModel, safeText } from "../workbench/inference.ts";
import { Observer, OBSERVER_PROMPT } from "./engine.ts";

export default function observerExtension(pi: ExtensionAPI): void {
	pi.registerFlag("allow-observer", { type: "boolean", default: false, description: "Allow explicitly requested background observer activation without an interactive confirmation" });
	let observer = new Observer(), ledger = newLedger(), model = "not selected", settings = defaults().observer;
	let timer: ReturnType<typeof setInterval> | undefined, generation = 0, lastNotice = "";
	let authorizing: symbol | undefined;
	const gateCalls = new Set<string>();
	function pause() { generation++; authorizing = undefined; stopTimer(); observer.stop(); }
	function stopTimer() { if (timer) clearInterval(timer); timer = undefined; }
	function status(): string {
		const sample = observer.snapshot();
		return safeText(`Observer ${observer.enabled ? observer.busy ? "reviewing" : "watching" : "paused"} · ${model}\nScope: ${settings.scope}. Calls ${ledger.calls}/${settings.maxCalls}; reserved/charged estimate $${ledger.chargedUsd.toFixed(4)}/$${settings.maxEstimatedCostUsd}. Input/output tokens ${ledger.inputTokens}/${ledger.outputTokens}.\n${sample.completedTools} completed tools, ${sample.toolFailures} failed; ${sample.activeTools.length} active; last activity ${sample.quietSeconds}s ago. Last observed SB result: ${sample.gateStatus} (present freshness not proven).\n${observer.latest ? `Latest advisory (${new Date(observer.latest.at).toISOString()}): ${JSON.stringify(observer.latest.summary)}` : "No model synthesis yet. Telemetry is not a correctness review."}\n${observer.error ?? ""}`, 5000);
	}
	function widget(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		if (!observer.enabled && !observer.latest && !observer.error) { ctx.ui.setWidget("observer", undefined); return; }
		const sample = observer.snapshot();
		ctx.ui.setWidget("observer", [
			`Observer ${observer.enabled ? observer.busy ? "reviewing" : "watching" : "paused"} · ${sample.completedTools} tools / ${sample.toolFailures} failures · ${sample.activeTools.length} active · $${ledger.chargedUsd.toFixed(3)} reserved`,
			observer.error ?? (observer.latest ? `Advisory: ${observer.latest.summary.summary}` : `Awaiting evidence · ${sample.quietSeconds}s since activity`),
		]);
	}
	const reset = (ctx: ExtensionContext) => { pause(); gateCalls.clear(); observer = new Observer(); ledger = newLedger(); model = "not selected"; lastNotice = ""; widget(ctx); };
	pi.on("session_start", (_event, ctx) => reset(ctx));
	pi.on("session_tree", (_event, ctx) => reset(ctx));
	pi.on("session_shutdown", () => pause());
	pi.on("agent_start", (_event, ctx) => { observer.setActive(true); widget(ctx); });
	pi.on("agent_settled", (_event, ctx) => { observer.setActive(false); widget(ctx); });
	pi.on("tool_execution_start", (event, ctx) => {
		if (event.toolName === "observer") return;
		if (event.toolName === "sb" && event.args?.op === "gates" && gateCalls.size < 128) gateCalls.add(event.toolCallId);
		observer.startTool(event.toolCallId, event.toolName); widget(ctx);
	});
	pi.on("tool_execution_end", (event, ctx) => {
		if (event.toolName === "observer") return;
		let gate: string | undefined;
		if (gateCalls.delete(event.toolCallId)) gate = event.isError ? "failed" : event.result?.details?.gates === "passed" ? "passed" : "completion observed; verification unknown";
		observer.endTool(event.toolCallId, event.toolName, event.isError, gate); widget(ctx);
	});
	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		// Public assistant text only. Never include thinking, user messages, tool args/results,
		// file contents, system prompt, credentials, or another session's history implicitly.
		observer.note(event.message.content.filter(c => c.type === "text").map(c => c.text).join("\n")); widget(ctx);
	});
	const showStatus = () => pi.sendMessage({ customType: "observer-shared", content: `Observer snapshot (advisory, not verification):\n${status()}`, display: true }, { triggerTurn: false });
	pi.registerCommand("how", { description: "Instant progress snapshot without a primary-model call", handler: async () => { showStatus(); } });
	pi.on("input", (event) => {
		if (event.source === "extension" || event.images?.length || !observer.enabled) return;
		if (/^(?:btw[,\s]+)?how(?:['’]?s| is) it going[?!.]*$/i.test(event.text.trim())) { showStatus(); return { action: "handled" }; }
	});
	pi.registerTool({ name: "observer", label: "Progress observer", description: "Read the cheap background observer's status/advisory summary, or pause it. This tool never enables spending or shares additional data. Activation is an explicit user command: /observer on PROVIDER/MODEL [telemetry|notes]. Its judgments are advisory, not SB verification, code review or completion authority.",
		parameters: Type.Object({ op: StringEnum(["status", "pause"] as const) }),
		async execute(_id, params, _signal, _update, ctx) { if (params.op === "pause") { pause(); widget(ctx); } return { content: [{ type: "text", text: status() }], details: { ledger: structuredClone(ledger) } }; },
	});
	pi.registerCommand("observer", { description: "Background progress: on [PROVIDER/MODEL] [telemetry|notes] | off | status | share", handler: async (args, ctx) => {
		const [op, requested, requestedScope, ...extra] = args.trim().split(/\s+/);
		let setup: symbol | undefined;
		try {
			if (op === "off" || op === "pause") { pause(); widget(ctx); return; }
			if (op === "share") { pi.sendMessage({ customType: "observer-shared", content: `User-requested observer snapshot. Advisory, not verification.\n${status()}`, display: true }, { triggerTurn: false }); return; }
			if (op !== "on") { ctx.ui.notify(status() + "\n/observer on [PROVIDER/MODEL] [telemetry|notes] | off | status | share", "info"); return; }
			if (authorizing) throw new Error("Observer setup is already awaiting approval. /observer off cancels it.");
			setup = Symbol(); authorizing = setup;
			if (!ctx.isProjectTrusted()) throw new Error("Trust this project before enabling a background reviewer.");
			if (extra.length || (requestedScope && !["telemetry", "notes"].includes(requestedScope))) throw new Error("Usage: /observer on [PROVIDER/MODEL] [telemetry|notes]");
			const epoch = generation, config = loadConfig(ctx);
			let ref: string | undefined = requested || config.roles.observer;
			if (!ref && ctx.hasUI) {
				const choices = [...ctx.modelRegistry.getAvailable()].sort((a, b) => a.cost.input + a.cost.output - b.cost.input - b.cost.output).map(modelRef);
				ref = await ctx.ui.select("Select observer model (catalog-price order; no calls yet)", choices);
			}
			if (!ref) throw new Error("Choose an explicit cheap provider/model; the observer never silently uses the primary model.");
			const selected = resolveModel(ctx, ref), chosen = { ...config.observer, ...(requestedScope ? { scope: requestedScope as "telemetry" | "notes" } : {}) };
			const allowed = pi.getFlag("allow-observer") || (ctx.hasUI && await ctx.ui.confirm("Enable a background progress observer?", `Model: ${modelRef(selected)}.\n${chosen.scope === "telemetry" ? "Sends only tool names, counts, durations, failures and observed gate status—no code, paths, messages or raw tool output." : "Also sends bounded PUBLIC ASSISTANT NOTES captured after enabling. Those notes may contain client facts or code; only approve a provider authorized for this project. No thinking, raw tool payloads, or full transcript."}\nAt most one call per ${chosen.intervalSeconds}s when evidence changes; ${chosen.maxCalls} calls and $${chosen.maxEstimatedCostUsd} catalog-price admission budget for this activation. Pricing is not a billing guarantee.\nNo tools, edits, task completion or automatic primary-agent wakeups. /observer off stops it; reload/session changes pause it.`));
			if (!allowed) return;
			if (epoch !== generation || authorizing !== setup) throw new Error("Session changed or observer setup was cancelled; enable again explicitly.");
			stopTimer(); observer.stop(); settings = chosen; ledger = newLedger(); model = modelRef(selected); lastNotice = "";
			observer.start(settings.scope); observer.setActive(!ctx.isIdle());
			const current = observer, currentLedger = ledger;
			const publish = () => {
				if (current !== observer || epoch !== generation) return;
				if (!current.enabled) stopTimer(); widget(ctx);
				pi.appendEntry("observer-update", { at: Date.now(), model, scope: settings.scope, latest: current.latest, ledger: structuredClone(currentLedger), error: current.error });
				const notice = current.error ?? (current.latest?.summary.health === "blocked" ? current.latest.summary.summary : "");
				if (notice && notice !== lastNotice && ctx.hasUI) ctx.ui.notify(`Observer advisory: ${notice}`, "warning");
				lastNotice = notice;
			};
			const tick = () => {
				if (current !== observer || epoch !== generation) return;
				widget(ctx);
				void current.tick(chosen.intervalSeconds, (snapshot, signal) => complete(ctx, { model: selected, system: OBSERVER_PROMPT, input: JSON.stringify(snapshot), limits: chosen, ledger: currentLedger, signal }), publish);
			};
			timer = setInterval(tick, 5000); timer.unref(); widget(ctx); tick();
		} catch (error) { ctx.ui.notify(safeText(error instanceof Error ? error.message : "Observer setup failed", 1000), "error"); }
		finally { if (setup && authorizing === setup) authorizing = undefined; }
	} });
}
