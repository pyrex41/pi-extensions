import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { lstat, readdir, readlink, stat as followStat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "smol-toml";
import { canonical, findProject } from "../lib/project.ts";
import { checked, runBin } from "../lib/run.ts";

export type SbProject = { root: string; spec: string; output: string };
export function getSbProject(cwd: string, requireSpec = true): SbProject | undefined {
	const root = findProject(cwd, "sb.toml");
	if (!root) return undefined;
	const manifest = parse(readFileSync(join(root, "sb.toml"), "utf8"));
	const paths = manifest.paths as Record<string, unknown> | undefined;
	// Explicit paths avoid silently hydrating fictitious convention-based context.
	if (typeof paths?.spec !== "string" || typeof paths.output !== "string") {
		throw new Error("sb.toml must declare [paths] spec and output for the Pi integration.");
	}
	const spec = resolve(root, paths.spec), output = resolve(root, paths.output);
	for (const path of [spec, output]) {
		const rel = relative(canonical(root), canonical(path));
		if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error("SB spec/output must stay inside the project root.");
	}
	if (requireSpec && !existsSync(spec)) throw new Error(`SB spec missing: ${paths.spec}. Project is not armed.`);
	return { root, spec, output };
}

const SKIP = new Set([".git", ".sb", ".scud", "node_modules", ".pi", "dist", "coverage", ".venv"]);
async function walk(root: string, dir = root): Promise<string[]> {
	const paths: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) paths.push(...await walk(root, path));
		else paths.push(relative(root, path));
	}
	return paths;
}

// Hash contents, not mtimes. Git includes tracked files and nonignored new files.
// Non-git projects use the same explicit cache/build-directory exclusions.
export async function fingerprint(project: SbProject, excludeOutput = false, signal?: AbortSignal): Promise<string> {
	const git = await runBin("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
		cwd: project.root, signal, timeoutMs: 10_000, maxBytes: 8 * 1024 * 1024,
	});
	if (signal?.aborted) throw new Error("Cancelled");
	let files: string[];
	if (git.ok) {
		if (git.stdout.startsWith("[Earlier output")) throw new Error("Project file list too large to verify safely.");
		files = git.stdout.split("\0").filter(Boolean);
	} else {
		if (existsSync(join(project.root, ".git"))) checked(git);
		files = await walk(project.root);
	}
	// Always include the manifest, spec and generated output, even if gitignored.
	files.push("sb.toml", relative(project.root, project.spec), relative(project.root, project.output));
	const hash = createHash("sha256");
	for (const file of [...new Set(files)].sort()) {
		signal?.throwIfAborted();
		const path = resolve(project.root, file);
		const explicit = [join(project.root, "sb.toml"), project.spec, project.output].includes(path);
		if (!explicit && file.split(/[\\/]/).some(part => SKIP.has(part))) continue;
		if (excludeOutput && canonical(path) === canonical(project.output)) continue;
		hash.update(file).update("\0");
		let stat;
		try { stat = await lstat(path); } catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			hash.update("missing\0"); continue;
		}
		if (stat.isSymbolicLink()) {
			hash.update(await readlink(path));
			const rel = relative(canonical(project.root), canonical(path));
			if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error(`Cannot fingerprint external symlink input: ${file}`);
			stat = await followStat(path);
			if (stat.isDirectory()) throw new Error(`Cannot fingerprint directory symlink input: ${file}`);
		}
		hash.update(String(stat.mode)).update("\0");
		if (stat.isFile()) {
			for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
		} else hash.update("directory");
		hash.update("\0");
	}
	return hash.digest("hex");
}
