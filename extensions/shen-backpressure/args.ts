export const SB_OPS = ["context", "gates", "gen", "derive", "audit", "init"] as const;
export type SbOp = (typeof SB_OPS)[number];

export type SbParams = {
	op: SbOp;
	lang?: string;
	regen?: boolean;
	evidence?: boolean;
	format?: string;
};

export type SbPlan = { kind: "error"; error: string } | { kind: "argv"; argv: string[] };

export function planSb(params: SbParams): SbPlan {
	switch (params.op) {
		case "context": {
			const argv = ["context", "-format", params.format === "json" ? "json" : "markdown"];
			if (params.evidence) argv.push("-evidence");
			return { kind: "argv", argv };
		}
		case "gates":
			return { kind: "argv", argv: ["gates"] };
		case "gen":
			return { kind: "argv", argv: ["gen"] };
		case "derive": {
			const argv = ["derive"];
			if (params.regen) argv.push("-regen");
			return { kind: "argv", argv };
		}
		case "audit":
			return { kind: "argv", argv: ["audit-report"] };
		case "init": {
			const argv = ["init", "-config", "-no-skills"];
			if (params.lang) argv.push("-lang", params.lang);
			return { kind: "argv", argv };
		}
		default:
			return { kind: "error", error: `unknown op: ${String(params.op)}` };
	}
}

export function sbTimeoutMs(op: SbOp): number {
	switch (op) {
		case "gates":
		case "derive":
			return 10 * 60_000;
		case "gen":
		case "init":
			return 2 * 60_000;
		default:
			return 30_000;
	}
}
