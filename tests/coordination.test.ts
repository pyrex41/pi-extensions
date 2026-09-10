import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import scudExtension from "../extensions/scud/index.ts";
import sbExtension from "../extensions/shen-backpressure/index.ts";
import { findOnPath } from "../extensions/lib/run.ts";
import { harness } from "./harness.ts";

const scud = process.env.SCUD_BIN || findOnPath("scud"), sb = process.env.SB_BIN || findOnPath("sb");
test("initialization requires approval and leaves no scaffolding when denied", { skip: !scud || !sb }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-consent-test-"));
	try {
		const h = harness(dir); h.ctx.ui.confirm = async () => false;
		scudExtension(h.api); sbExtension(h.api);
		await assert.rejects(h.call("todo", { op: "init" }), /approval/);
		await assert.rejects(h.call("sb", { op: "init", lang: "ts" }), /approval/);
		assert.equal(existsSync(join(dir, ".scud")), false);
		assert.equal(existsSync(join(dir, "sb.toml")), false);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("SCUD completion consumes shared SB evidence even without hook dispatch", { skip: !scud || !sb }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-shared-test-"));
	try {
		const h = harness(dir); scudExtension(h.api); sbExtension(h.api);
		await h.call("todo", { op: "init", items: ["Verify integration"] });
		await h.call("todo", { op: "start", id: "1" });
		await writeFile(join(dir, "core.shen"), "(datatype example X : number; ==== (sample X) : sample;)\n");
		await writeFile(join(dir, "guards.ts"), "// test output\n");
		await writeFile(join(dir, "sb.toml"), `[project]\nlang = "ts"\n[paths]\nspec = "core.shen"\noutput = "guards.ts"\n[[gates]]\nname = "integration"\nkind = "command"\nrun = "node -e 'process.exit(0)'"\n`);
		await assert.rejects(h.call("todo", { op: "done", id: "1" }), /blocked/);
		await h.call("sb", { op: "gates" });
		await h.call("todo", { op: "done", id: "1" });
	} finally { await rm(dir, { recursive: true, force: true }); }
});
