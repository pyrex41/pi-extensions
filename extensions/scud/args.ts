import type { TodoOp, TodoParams } from "./types.ts";

export type ScudPlan =
	| { kind: "error"; error: string }
	| { kind: "commands"; commands: string[][] };

const STATUS_FOR_OP: Partial<Record<TodoOp, string>> = {
	start: "in-progress",
	done: "done",
	drop: "cancelled",
};

export function planScud(params: TodoParams): ScudPlan {
	const tagArgs = params.tag ? ["-t", params.tag] : [];

	switch (params.op) {
		case "warmup":
			return { kind: "commands", commands: [["warmup", "--json"]] };

		case "next":
			return { kind: "commands", commands: [["next", ...tagArgs]] };

		case "list": {
			const args = ["list", "--json", ...tagArgs];
			if (params.status) args.push("-s", params.status);
			return { kind: "commands", commands: [args] };
		}

		case "show":
			if (!params.id) return { kind: "error", error: "id is required for show" };
			return { kind: "commands", commands: [["show", params.id, "--json", ...tagArgs]] };

		case "start":
		case "done":
		case "drop": {
			if (!params.id) return { kind: "error", error: `id is required for ${params.op}` };
			return {
				kind: "commands",
				commands: [["set-status", params.id, STATUS_FOR_OP[params.op]!, ...tagArgs]],
			};
		}

		case "stats":
			return { kind: "commands", commands: [["stats", "--json", ...tagArgs]] };

		case "waves":
			return { kind: "commands", commands: [["waves", "--json", ...tagArgs]] };

		case "commit": {
			const args = ["commit"];
			if (params.message) args.push("-m", params.message);
			return { kind: "commands", commands: [args] };
		}

		case "tags":
			return {
				kind: "commands",
				commands: [params.tag ? ["tags", params.tag] : ["tags"]],
			};

		case "append": {
			if (!params.title && !(params.items && params.items.length > 0)) {
				return { kind: "error", error: "title or items is required for append" };
			}
			const titles = params.items && params.items.length > 0 ? params.items : [params.title!];
			return {
				kind: "commands",
				commands: titles.map((title) => createArgs(title, params)),
			};
		}

		case "init": {
			const tag = params.tag || "main";
			const seeded = { ...params, tag };
			const commands: string[][] = [["init"], ["tags", tag]];
			if (seeded.items && seeded.items.length > 0) {
				for (const title of seeded.items) commands.push(createArgs(title, seeded));
			} else if (seeded.title) {
				commands.push(createArgs(seeded.title, seeded));
			}
			return { kind: "commands", commands };
		}

		default:
			return { kind: "error", error: `unknown op: ${String(params.op)}` };
	}
}

function createArgs(title: string, params: TodoParams): string[] {
	const args = ["create", "--title", title];
	if (params.tag) args.push("-t", params.tag);
	if (params.priority) args.push("--priority", params.priority);
	if (params.complexity !== undefined) args.push("--complexity", String(params.complexity));
	return args;
}
