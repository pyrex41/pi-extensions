import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

type Hook = (event: any, ctx: ExtensionContext) => any;
export function harness(cwd: string, session = "session-a") {
	const tools = new Map<string, ToolDefinition<any>>();
	const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
	const hooks = new Map<string, Hook[]>();
	const messages: Array<{ content: unknown; customType: string }> = [];
	const widgets = new Map<string, unknown>();
	const notifications: string[] = [];
	const entries: any[] = [];
	const flags = new Map<string, unknown>();
	const api = {
		registerFlag: () => {},
		getFlag: (name: string) => flags.get(name) ?? false,
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data: structuredClone(data) }),
		registerTool: (tool: ToolDefinition<any>) => tools.set(tool.name, tool),
		registerCommand: (name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) => commands.set(name, command),
		on: (name: string, hook: Hook) => hooks.set(name, [...(hooks.get(name) ?? []), hook]),
		sendMessage: (message: { content: unknown; customType: string }) => messages.push(message),
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd, hasUI: true, mode: "rpc", isProjectTrusted: () => true,
		waitForIdle: async () => {}, isIdle: () => true,
		sessionManager: { getSessionId: () => session, getBranch: () => entries },
		ui: {
			setWidget: (name: string, value: unknown) => widgets.set(name, value),
			notify: (message: string) => notifications.push(message),
			confirm: async () => true,
		},
	} as unknown as ExtensionCommandContext;
	return { api, ctx, tools, commands, messages, widgets, notifications, entries, flags,
		async call(name: string, params: any, signal?: AbortSignal) { return tools.get(name)!.execute("test-call", params, signal, undefined, ctx); },
		async event(name: string, event: any = {}) {
			const results = [];
			for (const hook of hooks.get(name) ?? []) results.push(await hook(event, ctx));
			return results;
		},
	};
}
