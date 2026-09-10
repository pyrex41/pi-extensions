import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export type RunResult = {
	ok: boolean;
	code: number;
	stdout: string;
	stderr: string;
	error?: string;
};

export type RunOptions = {
	cwd: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	env?: NodeJS.ProcessEnv;
};

export type BinRunner = (bin: string, args: string[], opts: RunOptions) => Promise<RunResult>;

const HOME_BIN_DIRS = [join(homedir(), ".local/bin"), join(homedir(), "go/bin")];

export function findOnPath(name: string, extraDirs: string[] = []): string | undefined {
	if (name.includes("/") && existsSync(name)) return name;
	const dirs = [...extraDirs, ...HOME_BIN_DIRS, ...(process.env.PATH ?? "").split(delimiter)];
	for (const dir of dirs) {
		if (!dir) continue;
		const candidate = join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

export function missingBinMessage(name: string, installHint: string): string {
	return `${name} is not on PATH. ${installHint}`;
}

export async function runBin(bin: string, args: string[], opts: RunOptions): Promise<RunResult> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: RunResult) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};

		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(bin, args, {
				cwd: opts.cwd,
				env: opts.env ?? process.env,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			finish({ ok: false, code: 127, stdout: "", stderr: message, error: message });
			return;
		}

		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});

		const onAbort = () => {
			child.kill("SIGTERM");
		};
		opts.signal?.addEventListener("abort", onAbort, { once: true });

		let timer: ReturnType<typeof setTimeout> | undefined;
		if (opts.timeoutMs && opts.timeoutMs > 0) {
			timer = setTimeout(() => {
				child.kill("SIGTERM");
				finish({
					ok: false,
					code: 124,
					stdout,
					stderr,
					error: `${bin} timed out after ${opts.timeoutMs}ms`,
				});
			}, opts.timeoutMs);
		}

		child.on("error", (err) => {
			if (timer) clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onAbort);
			const message =
				"code" in err && (err as NodeJS.ErrnoException).code === "ENOENT"
					? `command not found: ${bin}`
					: err.message;
			finish({ ok: false, code: 127, stdout, stderr, error: message });
		});

		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onAbort);
			const exit = code ?? 1;
			finish({
				ok: exit === 0,
				code: exit,
				stdout: stdout.trimEnd(),
				stderr: stderr.trimEnd(),
			});
		});
	});
}

export function formatRun(result: RunResult): string {
	const parts: string[] = [];
	if (result.stdout) parts.push(result.stdout);
	if (result.stderr) parts.push(result.stderr);
	if (result.error) parts.push(result.error);
	if (!result.ok && parts.length === 0) parts.push(`exit ${result.code}`);
	return parts.join("\n");
}
