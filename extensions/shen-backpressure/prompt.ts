export const SB_TOOL_DESCRIPTION = `Shen-Backpressure verification engine. Talks to the \`sb\` CLI. Specs live in specs/core.shen; gates are declared in sb.toml. Do not scrape the filesystem for gate status — ask this tool.

## Operations

| op | Fields | Effect |
|---|---|---|
| context | format?: markdown\\|json, evidence?: bool | Live project context (guard types, gates, backpressure) |
| gates | — | Run the manifest-defined verification gates |
| gen | — | Regenerate guard types from the Shen spec |
| derive | regen?: bool | Spec-equivalence drift gate; regen rewrites committed tests |
| audit | — | Long-form Markdown of the latest discharge report |
| init | lang?: go\\|ts | Scaffold specs/core.shen, sb.toml (no Claude skills) |

## Gate meaning
1. shengen — regenerate guard types
2. test — tests against regenerated types
3. build — compile against regenerated types
4. shen tc+ — spec internal consistency
5. tcb audit — generated-file integrity
6. shen-derive — when [[derive.specs]] is configured

When a gate fails, the failure is backpressure: fix that first. Never edit generated guard files; change specs/core.shen and re-run gen.`;

export const METHODOLOGY_SECTION = `
<Shen_Backpressure>
Formal verification gates for this project. The compiler enforces guard-type constructors; you write code that compiles.

Rules:
- Wrap raw values in guard types at I/O boundaries. Trust them internally.
- Follow the proof chain from \`sb context\`. You cannot skip a constructor step.
- Never edit generated guard files. Never bypass constructors. Never ignore constructor errors.
- If gates fail, fix the backpressure before new plan items.
- Use the sb tool (op:context / op:gates) instead of inventing verification commands.

Live context is injected below when available.
</Shen_Backpressure>
`;
