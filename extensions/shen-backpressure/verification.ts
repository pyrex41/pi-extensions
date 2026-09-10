import { canonical } from "../lib/project.ts";
import { fingerprint, getSbProject, type SbProject } from "./project.ts";

type Evidence = { status: "unknown" | "running" | "failed" | "stale" | "passed"; hash?: string };
// Shared by the two separately loaded extensions, including Pi's Jiti loader.
const key = Symbol.for("pyrex41.pi-extensions.verification.v1");
const shared = globalThis as typeof globalThis & { [key]?: Map<string, Evidence> };
const evidence = shared[key] ??= new Map<string, Evidence>();
export function gateState(root: string): Evidence { return evidence.get(canonical(root)) ?? { status: "unknown" }; }
export function setGateState(root: string, state: Evidence): void { evidence.set(canonical(root), state); }
export async function assertVerified(cwd: string, signal?: AbortSignal): Promise<void> {
	const project = getSbProject(cwd);
	if (!project) return;
	const state = gateState(project.root);
	if (state.status !== "passed" || state.hash !== await fingerprint(project, false, signal)) {
		if (state.status === "passed") setGateState(project.root, { status: "stale" });
		throw new Error("Completion/commit blocked: run sb op:gates successfully on the current project files first.");
	}
}
export async function beginGates(project: SbProject, signal?: AbortSignal): Promise<string> {
	if (gateState(project.root).status === "running") throw new Error("SB gates are already running in this session.");
	setGateState(project.root, { status: "running" });
	try { return await fingerprint(project, true, signal); }
	catch (error) { setGateState(project.root, { status: "failed" }); throw error; }
}
export async function finishGates(project: SbProject, before: string, signal?: AbortSignal): Promise<void> {
	if (before !== await fingerprint(project, true, signal)) {
		setGateState(project.root, { status: "stale" });
		throw new Error("Gate inputs changed during verification; run gates again on stable inputs.");
	}
	setGateState(project.root, { status: "passed", hash: await fingerprint(project, false, signal) });
}
