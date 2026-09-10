import { CONFIG_DIR_NAME, getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ROLES = ["planner", "reviewer", "skeptic", "synthesizer", "observer"] as const;
export type Role = typeof ROLES[number];
export type Limits = { maxCalls: number; maxEstimatedCostUsd: number; maxTokens: number; timeoutMs: number };
export type WorkbenchConfig = {
	roles: Partial<Record<Role, string>>;
	workflow: Limits & { concurrency: number };
	observer: Limits & { intervalSeconds: number; scope: "telemetry" | "notes" };
};
export function defaults(): WorkbenchConfig {
	return { roles: {}, workflow: { maxCalls: 12, maxEstimatedCostUsd: 2, maxTokens: 1200, timeoutMs: 60_000, concurrency: 2 },
		observer: { maxCalls: 40, maxEstimatedCostUsd: 0.25, maxTokens: 500, timeoutMs: 30_000, intervalSeconds: 90, scope: "telemetry" } };
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Workbench configuration must contain objects.");
	return value as Record<string, unknown>;
}
export function mergeConfig(base: WorkbenchConfig, input: unknown): WorkbenchConfig {
	const value = object(input), result = structuredClone(base);
	if (Object.keys(value).some(k => !["roles", "workflow", "observer"].includes(k))) throw new Error("Unknown workbench configuration field (configuration never enables automatic calls).");
	if (value.roles !== undefined) for (const [role, model] of Object.entries(object(value.roles))) {
		if (!ROLES.includes(role as Role) || typeof model !== "string" || !/^[\w.:-]+\/[\w./:@+-]+$/.test(model)) throw new Error("Roles must map known role names to provider/model IDs, not credentials or URLs.");
		result.roles[role as Role] = model;
	}
	for (const section of ["workflow", "observer"] as const) {
		if (value[section] === undefined) continue;
		for (const [key, val] of Object.entries(object(value[section]))) {
			if (section === "observer" && key === "scope" && (val === "telemetry" || val === "notes")) { result.observer.scope = val; continue; }
			const ranges: Record<string, [number, number]> = { maxCalls: [1, 100], maxEstimatedCostUsd: [0, 100], maxTokens: [128, 4000], timeoutMs: [1000, 120_000],
				...(section === "workflow" ? { concurrency: [1, 4] as [number, number] } : { intervalSeconds: [30, 3600] as [number, number] }) };
			const range = ranges[key];
			if (!range || typeof val !== "number" || !Number.isFinite(val) || val < range[0] || val > range[1] || (key !== "maxEstimatedCostUsd" && !Number.isInteger(val))) throw new Error(`Invalid workbench ${section}.${key}`);
			Object.assign(result[section], { [key]: val });
		}
	}
	return result;
}
export function loadConfig(ctx: ExtensionContext): WorkbenchConfig {
	let config = defaults();
	const paths = [join(getAgentDir(), "workbench.json")];
	if (ctx.isProjectTrusted()) paths.push(join(ctx.cwd, CONFIG_DIR_NAME, "workbench.json"));
	for (const path of paths) {
		let text: string;
		try { text = readFileSync(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw new Error("Unable to read workbench configuration."); }
		if (Buffer.byteLength(text) > 16_384) throw new Error("Workbench config exceeds 16 KiB.");
		try { config = mergeConfig(config, JSON.parse(text)); } catch { throw new Error("Invalid workbench.json. Check documented fields and numeric limits; do not put credentials in this file."); }
	}
	return config;
}
