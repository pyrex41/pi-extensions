import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

export const testCwd = mkdtempSync(join(tmpdir(), "pi-workbench-test-"));
const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(testCwd, "agent");
after(() => {
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	rmSync(testCwd, { recursive: true, force: true });
});

import type { Api, Model } from "@earendil-works/pi-ai";
export const testModel = { id: "small", name: "Test small", provider: "test-vendor", api: "openai-completions", baseUrl: "https://example.invalid", reasoning: false, input: ["text"], cost: { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 }, contextWindow: 32_000, maxTokens: 4000 } as Model<Api>;
export const artifact = JSON.stringify({ summary: "Scoped advisory result", findings: [], questions: ["What remains unverified?"], next: ["Run the actual tests"] });
export const summary = JSON.stringify({ health: "progressing", summary: "Tool activity observed; correctness is not established.", risks: [], next: "Inspect the next verification result." });
export function response(text: string) { return { role: "assistant", stopReason: "stop", content: [{ type: "text", text }], usage: { input: 50, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 100, cost: { total: 0.0001 } } }; }
