import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BinRunner } from "../lib/run.ts";
import { checked } from "../lib/run.ts";
import type { ScudTask } from "./types.ts";

export async function withScudLock<T>(root: string, action: () => Promise<T>): Promise<T> {
	const lock = join(root, ".scud", "pi-operation.lock");
	try { await mkdir(lock); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Another Pi SCUD operation is running. Retry later. After a crash, inspect .scud/pi-operation.lock/owner.json before manually removing that lock.");
		throw error;
	}
	try {
		await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
		return await action();
	} finally { await rm(lock, { recursive: true, force: true }); }
}

export async function initScud(root: string, bin: string, run: BinRunner, signal?: AbortSignal): Promise<void> {
	// Upstream init writes Claude/OpenCode skills. Keep those in a disposable staging directory.
	const stage = await mkdtemp(join(root, ".scud-init-"));
	try {
		checked(await run(bin, ["-C", stage, "init"], { cwd: stage, signal, timeoutMs: 20_000 }));
		signal?.throwIfAborted();
		await rename(join(stage, ".scud"), join(root, ".scud"));
	} finally { await rm(stage, { recursive: true, force: true }); }
}

type Claims = Record<string, { session: string; at: string }>;
export async function readClaims(root: string): Promise<Claims> {
	try { return JSON.parse(await readFile(join(root, ".scud", "pi-claims.json"), "utf8")); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}
export async function saveClaims(root: string, claims: Claims): Promise<void> {
	const path = join(root, ".scud", "pi-claims.json");
	await writeFile(`${path}.tmp`, JSON.stringify(claims, null, 2));
	await rename(`${path}.tmp`, path);
}
export async function requireClaim(root: string, tag: string, id: string, session: string): Promise<void> {
	if ((await readClaims(root))[`${tag}:${id}`]?.session !== session) throw new Error(`Task ${tag}:${id} is not claimed by this Pi session. Use start on a ready task first.`);
}
export function effectiveDeps(task: ScudTask, tasks: ScudTask[], visiting = new Set<string>()): string[] {
	if (visiting.has(task.id)) throw new Error("Parent cycle in SCUD tasks");
	visiting.add(task.id);
	const parent = tasks.find(t => t.id === task.parent_id);
	return [...new Set([...(task.dependencies ?? []), ...(parent ? effectiveDeps(parent, tasks, visiting) : [])])];
}
export function assertReady(task: ScudTask, tasks: ScudTask[]): void {
	if (task.status !== "pending") throw new Error(`Task ${task.id} is ${task.status}, not pending.`);
	for (const dep of effectiveDeps(task, tasks)) {
		if (tasks.find(t => t.id === dep)?.status !== "done") throw new Error(`Task ${task.id} has unmet dependency ${dep}.`);
	}
}

export function validateDependencies(tasks: ScudTask[], id: string, dependencies: string[]): void {
	if (new Set(dependencies).size !== dependencies.length) throw new Error("Duplicate dependencies");
	const task = tasks.find(t => t.id === id);
	if (!task) throw new Error(`Unknown task ${id}`);
	for (const dep of dependencies) if (!tasks.some(t => t.id === dep)) throw new Error(`Unknown dependency ${dep}; dependencies are phase-local.`);
	const updated = tasks.map(t => t.id === id ? { ...t, dependencies } : t);
	const visiting = new Set<string>(), done = new Set<string>();
	const visit = (current: ScudTask) => {
		if (visiting.has(current.id)) throw new Error("Dependency cycle");
		if (done.has(current.id)) return;
		visiting.add(current.id);
		for (const dep of effectiveDeps(current, updated)) {
			const next = updated.find(t => t.id === dep);
			if (!next) throw new Error(`Unknown dependency ${dep}`);
			visit(next);
		}
		visiting.delete(current.id); done.add(current.id);
	};
	updated.forEach(visit);
}

// SCUD 2.7 has no dependency mutation command. Use its own serializer, preserve all phases,
// and atomically replace only after a byte-for-byte concurrent-change check. This lock is
// shared by Pi sessions, NOT by standalone SCUD writers: do not mix writers during mutations.
export async function setDependencies(root: string, bin: string, run: BinRunner, tag: string, id: string, dependencies: string[], signal?: AbortSignal): Promise<void> {
	const path = join(root, ".scud", "tasks", "tasks.scg");
	const original = await readFile(path);
	const stage = await mkdtemp(join(root, ".scud", "deps-"));
	try {
		await writeFile(join(stage, "tasks.scg"), original);
		const json = checked(await run(bin, ["convert", join(stage, "tasks.scg"), "--format", "json"], { cwd: root, signal, timeoutMs: 20_000, maxBytes: 8 * 1024 * 1024 }));
		const phases = JSON.parse(json.stdout) as Record<string, { tasks: ScudTask[] }>;
		const tasks = phases[tag]?.tasks;
		if (!tasks) throw new Error(`Unknown phase ${tag}`);
		validateDependencies(tasks, id, dependencies);
		const task = tasks.find(t => t.id === id)!;
		if (task.status !== "pending") throw new Error("Only pending tasks can have their dependencies changed.");
		task.dependencies = dependencies;
		await writeFile(join(stage, "tasks.json"), JSON.stringify(phases));
		const scg = checked(await run(bin, ["convert", join(stage, "tasks.json"), "--format", "scg"], { cwd: root, signal, timeoutMs: 20_000, maxBytes: 8 * 1024 * 1024 }));
		if (scg.stdout.startsWith("[Earlier output")) throw new Error("SCUD serialization exceeded the safe size limit.");
		await writeFile(join(stage, "new.scg"), `${scg.stdout}\n`);
		signal?.throwIfAborted();
		if (!original.equals(await readFile(path))) throw new Error("SCUD changed outside Pi; refusing to overwrite. Retry without external writers.");
		await rename(join(stage, "new.scg"), path);
	} finally { await rm(stage, { recursive: true, force: true }); }
}
