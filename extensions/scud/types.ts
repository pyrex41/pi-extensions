export const TODO_OPS = [
	"init",
	"warmup",
	"next",
	"list",
	"show",
	"start",
	"done",
	"drop",
	"append",
	"stats",
	"waves",
	"commit",
	"tags",
	"release",
	"dependencies",
] as const;

export type TodoOp = (typeof TODO_OPS)[number];

export type TodoParams = {
	op: TodoOp;
	id?: string;
	title?: string;
	items?: string[];
	status?: string;
	tag?: string;
	message?: string;
	priority?: string;
	complexity?: number;
	dependencies?: string[];
};

export type ScudTask = {
	id: string;
	title: string;
	description?: string;
	status: string;
	complexity?: number;
	priority?: string;
	dependencies?: string[];
	parent_id?: string;
	assigned_to?: string;
};

export type WarmupStats = {
	total: number;
	done: number;
	pending: number;
	in_progress: number;
	failed?: number;
	blocked?: number;
};

export type WarmupNextTask = {
	id: string;
	title: string;
	priority?: string;
	complexity?: number;
	dependencies?: string[];
};

export type Warmup = {
	active_tag: string;
	stats?: WarmupStats;
	next_task?: WarmupNextTask;
};

export type TodoDetails = {
	op: TodoOp;
	ok: boolean;
	tag?: string;
	warmup?: Warmup;
	tasks?: ScudTask[];
	error?: string;
};
