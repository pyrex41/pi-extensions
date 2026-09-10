import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export type RunResult = { ok: boolean; code: number; stdout: string; stderr: string; error?: string };
export type RunOptions = { cwd: string; signal?: AbortSignal; timeoutMs?: number; env?: NodeJS.ProcessEnv; maxBytes?: number };
export type BinRunner = (bin: string, args: string[], opts: RunOptions) => Promise<RunResult>;
export const MAX_OUTPUT_BYTES = 24 * 1024;

// Each stream is bounded while running, not just when returning to the model.
export class OutputBuffer {
	private text = "";
	private omitted = false;
	private maxBytes: number;
	private maxLines: number;
	constructor(maxBytes = MAX_OUTPUT_BYTES, maxLines = 950) { this.maxBytes = maxBytes; this.maxLines = maxLines; }
	add(chunk: string): void {
		this.text += chunk;
		const bytes = Buffer.from(this.text);
		if (bytes.length > this.maxBytes) {
			this.text = bytes.subarray(bytes.length - this.maxBytes).toString("utf8");
			this.omitted = true;
		}
		const lines = this.text.split("\n");
		if (lines.length > this.maxLines) { this.text = lines.slice(-this.maxLines).join("\n"); this.omitted = true; }
	}
	value(): string {
		return (this.omitted ? "[Earlier output discarded; showing bounded tail.]\n" : "") + this.text.trimEnd();
	}
}

export function findOnPath(name: string, extraDirs: string[] = []): string | undefined {
	const candidates = name.includes("/") ? [name] : [
		...extraDirs, ...(process.env.PATH ?? "").split(delimiter),
		join(homedir(), ".local/bin"), join(homedir(), "go/bin"),
	].filter(Boolean).map(dir => join(dir, name));
	return candidates.find(path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } });
}

export function missingBinMessage(name: string, hint: string): string { return `${name} executable not found. ${hint}`; }

export async function runBin(bin: string, args: string[], opts: RunOptions): Promise<RunResult> {
	if (opts.signal?.aborted) return { ok: false, code: 130, stdout: "", stderr: "", error: "Cancelled" };
	return new Promise(resolve => {
		const stdout = new OutputBuffer(opts.maxBytes, opts.maxBytes ? Number.MAX_SAFE_INTEGER : 950), stderr = new OutputBuffer();
		const child = spawn(bin, args, {
			cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		let reason: string | undefined, forcedCode = 1, settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let escalation: ReturnType<typeof setTimeout> | undefined;
		const killTree = (signal: NodeJS.Signals) => {
			if (!child.pid) return;
			try {
				if (process.platform === "win32") {
					spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
				} else process.kill(-child.pid, signal);
			} catch { /* process group already exited */ }
		};
		const finish = (code: number, error?: string) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			if (escalation) clearTimeout(escalation);
			opts.signal?.removeEventListener("abort", onAbort);
			resolve({ ok: !reason && code === 0, code: reason ? forcedCode : code,
				stdout: stdout.value(), stderr: stderr.value(), error: reason ?? error });
		};
		const stop = (message: string, code: number) => {
			if (reason || settled) return;
			reason = message; forcedCode = code;
			killTree("SIGTERM");
			escalation = setTimeout(() => {
				killTree("SIGKILL");
				child.stdout?.destroy(); child.stderr?.destroy();
				finish(code);
			}, 500);
		};
		const onAbort = () => stop("Cancelled", 130);
		child.stdout?.setEncoding("utf8").on("data", (s: string) => stdout.add(s));
		child.stderr?.setEncoding("utf8").on("data", (s: string) => stderr.add(s));
		child.on("error", error => finish(127, error.message));
		child.on("close", code => {
			// A parent can exit on TERM while a grandchild ignores it. Kill the group before resolving.
			if (reason) killTree("SIGKILL");
			finish(code ?? 1);
		});
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		if (opts.signal?.aborted) onAbort();
		if (opts.timeoutMs) timer = setTimeout(() => stop(`Command timed out after ${opts.timeoutMs}ms`, 124), opts.timeoutMs);
	});
}

export function formatRun(result: RunResult): string {
	return [result.stdout, result.stderr, result.error].filter(Boolean).join("\n") || (result.ok ? "ok" : `exit ${result.code}`);
}
export function bounded(text: string): string { const buffer = new OutputBuffer(); buffer.add(text); return buffer.value(); }
export function checked(result: RunResult): RunResult {
	if (!result.ok) throw new Error(formatRun(result));
	return result;
}
