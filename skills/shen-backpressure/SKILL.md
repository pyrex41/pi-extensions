---
name: shen-backpressure
description: Formal backpressure for AI coding through Shen sequent-calculus types, shengen guard generation, and optional shen-derive spec-equivalence checks. Activates when the user mentions formal verification, Shen types, guard types, backpressure, invariant enforcement, or spec-vs-implementation verification.
---

# Shen-Backpressure

Formal type specs (Shen sequent calculus) plus a codegen bridge (shengen) that emits guard types with opaque constructors. The target-language compiler enforces the spec: you cannot construct a value without proving its preconditions.

Use the `sb` tool. Do not scrape logs or invent gate commands.

## Why this works

Guard types use module-private fields:

- Go: unexported struct fields
- TypeScript: `private` class fields
- Rust: private / `pub(crate)` fields

If a function requires `TenantAccess`, the caller must have gone through `NewTenantAccess(...)`. Skipping a step fails the build (gate 3), and that failure is injected as backpressure.

The LLM does not police this. The compiler does.

## Commands

- `sb` op `init` — scaffold `specs/core.shen` and `sb.toml`
- `sb` op `context` — live guard types, proof chain, gates, latest failure
- `sb` op `gen` — regenerate guard types
- `sb` op `gates` — run the manifest pipeline
- `sb` op `derive` — spec-equivalence drift (`regen: true` to rewrite)
- `sb` op `audit` — discharge report
- `/sb` and `/sb-gates` — the same from the prompt bar

## Guard-type discipline

1. Wrap at the boundary (HTTP, CLI, consumers).
2. Trust internally — functions take and return guard types.
3. Follow the proof chain from `sb` op `context`.
4. Extract with accessors for SQL/JSON.

Never edit generated guard files. Never bypass constructors. Never ignore constructor errors. Never duplicate constructor validation.

## When a gate fails

| Gate | Failure means | Fix |
|------|--------------|-----|
| shengen | Spec syntax | Fix `specs/core.shen` |
| test | Constructor rejected input, or handler skipped guards | Fix tests or handlers |
| build | Spec evolved, code uses old signatures | Update call sites |
| shen tc+ | Spec inconsistent | Fix contradictory rules |
| tcb audit | Hand-edited generated files | Regen; remove extras from shenguard/ |
| shen-derive | Drift or impl mismatch | Review diff; `derive` with `regen` if intentional |

Headless Ralph loops stay on the `sb loop` CLI (`RALPH_HARNESS` can point at `pi -p`). This extension is the interactive surface.
