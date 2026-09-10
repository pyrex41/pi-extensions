import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findProject(cwd: string, marker: string): string | undefined {
	let dir = resolve(cwd);
	for (;;) {
		if (existsSync(join(dir, marker))) return dir;
		if (existsSync(join(dir, ".git"))) return undefined;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export function canonical(path: string): string {
	try { return realpathSync(path); } catch {
		const parent = dirname(path);
		return parent === path ? path : join(canonical(parent), path.slice(parent.length + 1));
	}
}
