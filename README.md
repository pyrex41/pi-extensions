# Pi extensions: SCUD, Shen-Backpressure, workflows and observer

Project-local DAG tasks and verification workflows for Pi. Requires **Pi 0.85.1+**, **Node 22.18+**, and the `scud` / `sb` CLIs for the integrations you enable. Tested with SCUD 2.7.2 and SB 0.3.0; CI also builds pinned upstream revisions.

## Model-independent workflows and cheap progress updates

New in 0.3: a **tool-less advisory workflow runner** and an **opt-in background progress observer**, using any appropriately configured model in Pi's registry.

- `/workflow`: model-routed planner/reviewer/skeptic/synthesis stages, validated DAGs, bounded parallelism, background status/cancel and branch-local resume.
- `/observer on`: choose a cheap model and approve telemetry-only or public-notes scope. Summarizes changing activity without waking the main model; pauses on errors or exhausted limits.
- `/how`: instant telemetry/cached-advice snapshot. While observation is enabled, an exact “btw, how's it going?” also uses this no-main-model path.
- `/observer off`: stop observation. Nothing starts or spends money merely because the package is installed.

Coding, shell execution, task ownership and actual verification stay in the main Pi session. This is an advisory V1, **not an autonomous coding swarm or full Grok/Ultracode clone**. See the [workbench guide](docs/WORKBENCH.md) and [source research](docs/WORKBENCH_RESEARCH.md) for commands, disclosure scope, budgets and limitations.

## Install / upgrade

```bash
pi install git:github.com/pyrex41/pi-extensions
# Then /reload inside an already-running Pi session.
```

For a reproducible install, append `@<commit>` to the git source. Remove a previous **local-path** install before switching to git: Pi considers those separate packages and would otherwise register duplicate tools.

For development:

```bash
npm ci
pi install /absolute/path/to/pi-extensions
```

Pi supplies the SDK and TypeBox at runtime. They are optional peers and development dependencies, not bundled runtime dependencies. `smol-toml` is the only runtime dependency. Package installs omit development dependencies; local development uses `npm ci`.

Binary selection: `SCUD_BIN` / `SB_BIN` overrides, then executable lookup on `PATH`, then `~/.local/bin` and `~/go/bin`. Nothing is installed automatically.

## Opt-in and project roots

Tools are available globally, but **no project is initialized automatically**. Workflow prompt sections and widgets activate only for configured projects. Initialization requires interactive/RPC confirmation; unattended runs require the explicit `--allow-scud-init` or `--allow-sb-init` flag.

Root discovery searches cwd and ancestors, stopping at the repository boundary. It never searches descendant directories or activates nested manifest sketches. A trusted Pi project is required to read task/configuration state or run manifest commands.

- SCUD: `.scud/` is the opt-in marker. Pi initialization stages the upstream scaffold and installs **only `.scud/`**, not Claude/OpenCode skills.
- SB: `sb.toml` must explicitly declare `[paths] spec` and `output`, with an existing spec inside the project. Missing/invalid configuration produces an error, **not convention-derived imaginary context**. Gate definitions remain owned by SB; no fixed gate count or spec filename is assumed.

## SCUD

Use `todo` with an `op`:

| Operation | Parameters / behavior |
|---|---|
| `init` | Optional `tag` (default `main`), `items`; explicit approval required |
| `warmup`, `next`, `list`, `show`, `stats`, `waves`, `tags` | Inspect the DAG; `show` requires `id`; `list` accepts `status`; `tag` selects the phase where supported |
| `append` | `title` or `items`; optional `tag`, `priority`, `complexity` |
| `dependencies` | `id`, optional `tag`, replacement `dependencies`; `[]` clears edges |
| `start` | Claim a ready task using `id` and optional `tag` |
| `release` | Release your claim and return the task to pending |
| `done`, `drop` | Complete/cancel your claimed task and release it |
| `commit` | `id`, optional `tag`/`message`; commits **already-staged** files with `[tag:id]` prefix |

Sequence: **warmup → next → start → work → verify → commit (if requested) → done**. Commit requires the explicit task and its session-owned claim; it never selects another in-progress task or stages unrelated files.

Dependencies are phase-local. Unknown IDs, cycles (including inherited parent dependencies), edits to non-pending tasks, and unmet dependencies at claim time are rejected. SCUD 2.7 lacks a dependency mutation command, so Pi uses SCUD's own JSON/SCG converter and an atomic file replacement, with a concurrent-change check.

### Coordination and recovery

`.scud/pi-operation.lock/` serializes operations across cooperating Pi sessions. `.scud/pi-claims.json` records owners using stable Pi session IDs. Claims survive `/reload` and resume; forks/new sessions have different owners. A second session cannot claim or finish the same task. Starting your already-owned task is idempotent.

**This does not coordinate with standalone `scud`, swarm, or other writers. Do not run those concurrently with Pi mutations.** In particular, the CLI uses a different locking protocol; the dependency update's change check does not eliminate every external-writer race.

- `/todos`: bounded report in the transcript and model history; no custom modal renderer.
- `/scud-release TAG ID`: human-confirmed recovery after the previous worker has stopped. Resets an in-progress task to pending and removes its Pi claim.
- After a process crash, inspect `.scud/pi-operation.lock/owner.json` and confirm that worker has stopped before manually removing the lock directory. Locks are never silently stolen on a timer.
- Pre-existing CLI-created in-progress tasks must be deliberately returned to pending before Pi can claim them.

Ignore `.scud/pi-claims.json`, `.scud/pi-claims.json.tmp`, `.scud/pi-operation.lock/`, and `.scud/deps-*/` in application repositories; they are local coordination state, not shared task definitions.

## Shen-Backpressure

| `sb` operation | Behavior |
|---|---|
| `context` | Manifest/spec context; optional `format: json`, `evidence: true` |
| `gates` | Execute the manifest's pipeline and establish verification evidence |
| `gen` | Regenerate guards and invalidate prior evidence |
| `derive` | Check equivalence; `regen: true` rewrites derived files and invalidates evidence |
| `audit` | SB's discharge audit report |
| `init` | Explicitly approved scaffold; optional `lang: go` or `ts`; skips Claude skills |

- `/sb` and `/sb-gates` execute directly and retain the bounded report **immediately** in the transcript/model history, without initiating a model turn.
- `/sb-fix` is a distinct prompt template that asks the agent to investigate and resolve failures. It no longer collides with `/sb-gates`.
- Escape cancels a TUI command; `/sb-cancel` cancels an active slash command in TUI/RPC. Tool calls use Pi's abort signal; session shutdown cancels active slash commands.
- Live context is requested through the tool/command, not spawned and injected into the system prompt on every user message.

### Enforcement and its limits

Only successful **gates** establish a passing state. Context/audit success never clears failed verification. The widget separately tracks unknown/running/failed/stale/passed gate state.

Pi blocks `edit`/`write` against the configured generated output, including path/symlink aliases. SCUD `done` and `commit` require a successful gate run matching current file contents. Successful evidence is invalidated conservatively after every `bash`, `edit`, or `write` result, as well as generation. External file changes are detected again when completing/committing. Reload starts with unknown evidence.

Fingerprints include file contents and modes, using tracked/nonignored files in Git projects (a directory walk otherwise), with cache/build exclusions: `.git`, `.sb`, `.scud`, `.pi`, `node_modules`, `dist`, `coverage`, `.venv`. The manifest, spec, and configured output are always included even if ignored. External and directory symlink inputs fail closed. Inputs changing during gates invalidate the run; generated-output changes from the pipeline are expected.

**This is workflow enforcement, not a sandbox or a claim of complete proof.** It cannot stop arbitrary shell writes, standalone git/SCUD commands, other processes, forged tool implementations, or a final conversational answer. It does not fingerprint external services, environment variables, ignored dependency trees, or all outputs of arbitrary custom generators. Keep independent SB/CI checks for merge/release enforcement, and keep secrets out of command output. Formal guarantees depend on the actual spec, trusted code base and gates, not the prompt text.

## Execution safety

CLI failures throw actual Pi tool errors. Processes receive cancellation and deadlines, with process-tree termination and forced-kill escalation. Windows uses `taskkill /T /F`; CI exercises macOS/Linux.

Output buffers are bounded while running. Model-visible reports retain a **24 KiB / 950-line tail** with an explicit discard notice. Excess output is discarded; no unredacted full-output log is written. Internal SCUD JSON conversion/file listing has a separate bounded 8 MiB capacity and refuses truncated input. Use task filters/`show` or a narrower gate to inspect oversized reports.

## Verification

```bash
npm ci
npm run check       # strict TypeScript + unit/integration tests
npm pack --dry-run
```

Tests include the real Pi RPC loader/report delivery, process cancellation/descendants, initialization consent, root/trust boundaries, dependency cycles, competing session claims, explicitly scoped commits, guard protection and gate freshness. Real CLI tests skip when their binary is unavailable; CI builds pinned upstream CLIs on macOS and Linux so those tests run.
