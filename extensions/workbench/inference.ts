import type { Api, Model, Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Limits } from "./config.ts";

export function safeText(text: string, maxBytes = 24_000): string {
	// Best-effort hygiene, NOT DLP. No raw tool payloads/transcripts enter the observer.
	let clean = text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
	clean = clean.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
		.replace(/([?&](?:api[_-]?key|token|access_token|secret|password)=)[^\s&#]+/gi, "$1[REDACTED]")
		.replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9_]{16,}|github_pat_[a-zA-Z0-9_]{16,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED]")
		.replace(/(\b(?:authorization|api[_-]?key|access[_-]?token|password|secret)["']?\s*[=:]\s*["']?)(?:Bearer\s+)?[^\s,"'}]+/gi, "$1[REDACTED]");
	for (const [key, value] of Object.entries(process.env)) if (/TOKEN|SECRET|PASSWORD|(?:^|_)KEY$/.test(key) && value && value.length >= 8) clean = clean.split(value).join("[REDACTED]");
	if (Buffer.byteLength(clean) <= maxBytes) return clean;
	return Buffer.from(clean).subarray(0, maxBytes - 32).toString("utf8") + "\n[TRUNCATED: evidence incomplete]";
}
export function resolveModel(ctx: ExtensionContext, ref?: string): Model<Api> {
	const slash = ref?.indexOf("/") ?? -1;
	const model = ref ? (slash > 0 ? ctx.modelRegistry.find(ref.slice(0, slash), ref.slice(slash + 1)) : undefined) : ctx.model;
	if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) throw new Error("Selected provider/model is unavailable or lacks configured Pi authentication. No automatic fallback was used.");
	return model;
}
export function modelRef(model: Model<Api>): string { return `${model.provider}/${model.id}`; }
export function emptyUsage(): Usage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }; }
export type Ledger = { calls: number; chargedUsd: number; inputTokens: number; outputTokens: number; usage?: Usage };
export function newLedger(): Ledger { return { calls: 0, chargedUsd: 0, inputTokens: 0, outputTokens: 0, usage: emptyUsage() }; }
export function usageDelta(total: Usage, prior = emptyUsage()): Usage {
	const result = emptyUsage();
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) result[key] = Math.max(0, total[key] - prior[key]);
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) result.cost[key] = Math.max(0, total.cost[key] - prior.cost[key]);
	return result;
}
function addUsage(ledger: Ledger, usage: Usage) {
	const total = ledger.usage ??= emptyUsage();
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) if (Number.isFinite(usage[key]) && usage[key] >= 0) total[key] += usage[key];
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) if (Number.isFinite(usage.cost?.[key]) && usage.cost[key] >= 0) total.cost[key] += usage.cost[key];
}
export function reserve(ledger: Ledger, limits: Limits, model: Model<Api>, bytes: number): number {
	const rates = [model.cost.input, model.cost.output, model.cost.cacheRead, model.cost.cacheWrite];
	if (rates.some(rate => !Number.isFinite(rate) || rate < 0)) throw new Error("Model catalog has invalid pricing; cannot reserve a budget.");
	// Bytes + framing is a deliberately conservative text-token estimate. Catalog prices
	// and provider billing can differ: this is an admission budget, not an invoice guarantee.
	const cost = ((bytes + 2048) * Math.max(model.cost.input, model.cost.cacheRead, model.cost.cacheWrite) + limits.maxTokens * model.cost.output) / 1_000_000;
	if (ledger.calls >= limits.maxCalls || ledger.chargedUsd + cost > limits.maxEstimatedCostUsd) throw new Error("Budget exhausted: no additional model call admitted.");
	ledger.calls++; ledger.chargedUsd += cost;
	return cost;
}
export type InferenceRequest = { model: Model<Api>; system: string; input: string; limits: Limits; ledger: Ledger; signal: AbortSignal };
export type Infer = (request: InferenceRequest) => Promise<string>;

export async function complete(ctx: ExtensionContext, request: InferenceRequest): Promise<string> {
	const { model, limits, ledger } = request;
	request.signal.throwIfAborted();
	const system = safeText(request.system, 8000), input = safeText(request.input, 32_000);
	const charge = reserve(ledger, limits, model, Buffer.byteLength(system + input));
	const controller = new AbortController();
	const abort = () => controller.abort();
	request.signal.addEventListener("abort", abort, { once: true });
	if (request.signal.aborted) abort();
	const timer = setTimeout(abort, limits.timeoutMs);
	let rejectAbort: (() => void) | undefined;
	const stopped = new Promise<never>((_resolve, reject) => {
		rejectAbort = () => reject(new Error("Model request cancelled or timed out; its reservation remains charged."));
		controller.signal.addEventListener("abort", rejectAbort, { once: true });
		if (controller.signal.aborted) rejectAbort();
	});
	try {
		const response = await Promise.race([ctx.modelRegistry.complete(model, {
			systemPrompt: system, messages: [{ role: "user", content: [{ type: "text", text: input }], timestamp: Date.now() }],
		}, { signal: controller.signal, maxTokens: limits.maxTokens }), stopped]);
		request.signal.throwIfAborted();
		const usage: Usage = response.usage;
		if (usage) {
			addUsage(ledger, usage);
			ledger.inputTokens = ledger.usage!.input + ledger.usage!.cacheRead + ledger.usage!.cacheWrite;
			ledger.outputTokens = ledger.usage!.output;
		}
		if (usage && Number.isFinite(usage.cost?.total) && usage.cost.total >= 0) {
			ledger.chargedUsd += Math.max(0, usage.cost.total - charge); // Never refund a reservation based on optimistic/missing usage.
		}
		if (response.stopReason === "error" || response.stopReason === "aborted" || response.stopReason === "length") throw new Error("Model request failed, was cancelled, or exhausted its output limit. No result accepted.");
		return safeText(response.content.filter(c => c.type === "text").map(c => c.text).join("\n"), 12_000);
	} catch {
		// Provider exceptions may include request payloads or headers. Never persist/log them.
		if (controller.signal.aborted || request.signal.aborted) throw new Error("Model request cancelled or timed out; reservation retained.");
		throw new Error("Model request failed or exhausted its output limit. Check provider/authentication in Pi; raw provider details were withheld.");
	} finally {
		clearTimeout(timer); request.signal.removeEventListener("abort", abort);
		if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
	}
}
