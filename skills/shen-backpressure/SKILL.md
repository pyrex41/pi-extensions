---
name: shen-backpressure
description: Shen specifications, guard constructors, verification gates and backpressure in explicitly configured SB projects.
---

# Shen-Backpressure for Pi

Use `sb` op `context` to inspect the project's actual spec, output path, proof chain and gate pipeline. Do not assume `specs/core.shen`, fixed constructor names, or a fixed gate count. Do not scrape internal CLI logs for gate status.

SB requires a trusted project with `sb.toml` at cwd or an ancestor within the repository. `[paths] spec` and `output` must be explicit and the spec must exist. Nested sketches are not activated automatically. Report missing configuration; do not present convention-derived defaults as a live project.

`init` requires human confirmation (or the user's explicit headless `--allow-sb-init` flag). It skips Claude skills. Never initialize without approval.

## Workflow

1. Wrap raw inputs with generated constructors at boundaries; follow the actual proof chain.
2. Never bypass constructors, ignore their errors, or hand-edit generated guards.
3. Change the real spec and run `gen` when regeneration is needed.
4. Run `gates` after changes. Fix failures before continuing or completing the task.
5. `derive` checks equivalence; intentional rewrites use `regen: true`. `audit` shows the SB discharge report.

Only `gates` establishes passing evidence. Successful context/audit commands cannot clear a failed gate state. Pi blocks direct edit/write of the configured generated output and requires fresh gate evidence before SCUD done/commit. File changes, generation, shell calls and reload invalidate evidence. These checks do not sandbox arbitrary shell commands or external writers, and do not prove facts beyond the configured spec/TCB/gates.

## Commands

- `/sb`: context report, retained in the transcript/model history.
- `/sb-gates`: run gates and retain the bounded report without starting a model turn.
- `/sb-fix`: prompt the agent to investigate and fix backpressure (distinct from the command).
- `/sb-cancel`: cancel an active slash command; Escape also cancels in the TUI.

Outputs are bounded to a 24 KiB/950-line tail. Keep credentials out of gate output. See [the package README](../../README.md) for fingerprint coverage, concurrency and execution limits.

Headless Ralph loops remain on `sb loop`; explicitly configure `RALPH_HARNESS="pi -p"` when desired. The extension does not silently change a manifest's harness or migrate another project's configuration.
