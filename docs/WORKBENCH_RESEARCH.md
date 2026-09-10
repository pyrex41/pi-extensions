# Workflow / observer research

This is a clean Pi-native implementation of selected public design patterns, not a source port or a claim of compatibility with another harness's scripts.

## Sources inspected

### Grok Build (official source)

Repository: [xai-org/grok-build](https://github.com/xai-org/grok-build), inspected at `37949780c144e37df692e3d669051a21fec24f20`.

- [Subagents and personas](https://github.com/xai-org/grok-build/blob/37949780c144e37df692e3d669051a21fec24f20/crates/codegen/xai-grok-pager/docs/user-guide/16-subagents.md): independent context, role/model routing, explicit capability modes, background execution, task output/cancellation, worktree isolation, depth limits and lifecycle UI.
- [Background tasks and monitoring](https://github.com/xai-org/grok-build/blob/37949780c144e37df692e3d669051a21fec24f20/crates/codegen/xai-grok-pager/docs/user-guide/20-background-tasks.md): distinguish one-shot tasks, periodic checks and streaming monitors; detached scheduled work; bounded cadence; visible still-running indicators.
- [Agent definition contract](https://github.com/xai-org/grok-build/blob/37949780c144e37df692e3d669051a21fec24f20/crates/codegen/xai-grok-agent/README.md): tools, model configuration, personas and explicit completion contracts are separate concerns.

Grok's documented routing already supports overrides; the point here is not to reimplement its model backend. Pi's registry is the native provider-independent execution interface we already have.

### Ultracode workflows (community catalogue)

Repository: [hesreallyhim/ultracode-workflows](https://github.com/hesreallyhim/ultracode-workflows), inspected at `9b5404d11b885b28380d3eb17471ef7b17601b5e`.

- [README](https://github.com/hesreallyhim/ultracode-workflows/blob/9b5404d11b885b28380d3eb17471ef7b17601b5e/README.md): executable orchestration vs prompt-only plans; structured artifacts; checkpoint/handoff patterns; progress observation. The catalogue itself describes its full SDLC conductor as aspirational, not battle-tested autonomous shipping.
- [Pattern language](https://github.com/hesreallyhim/ultracode-workflows/blob/9b5404d11b885b28380d3eb17471ef7b17601b5e/plugins/ultracode-workflows/docs/PATTERNS.md): pipeline unless a barrier is justified, differentiated charters, independent skepticism, arithmetic coverage, bounded retries and honest non-convergence.
- [Deep code review](https://github.com/hesreallyhim/ultracode-workflows/blob/9b5404d11b885b28380d3eb17471ef7b17601b5e/plugins/ultracode-workflows/workflows/deep-code-review.js): concern-specific fan-out followed by adversarial challenge and synthesis.

This is a community workflow library, **not Anthropic's harness implementation**. No ultracode unlocker, binary patcher, account proxy or billing workaround was installed or used.

### Pi

Validated against Pi 0.85.1's bundled extension, SDK, TUI and RPC documentation, its subagent example and its Q&A example using `ctx.modelRegistry.complete`. The implementation uses native lifecycle hooks and registry authentication; it does not create nested Pi runtimes with recursively loaded extensions.

## Synthesis

| Pattern | Adopted here | Why |
|---|---|---|
| Model-routed roles | Planner/reviewer/skeptic/synthesizer plus an explicitly selected observer | Model choice is independent of workflow mechanics; no silent expensive observer fallback |
| Deterministic orchestration | Validated data-only DAG, dependency-ready scheduling, bounded concurrency | Avoid letting a model decide whether to skip mandatory analysis stages; no arbitrary JS evaluation |
| Independent criticism | Separate fresh calls with different charters; explicit unresolved evidence | Better than a single generator grading itself; consensus is still not proof |
| Background lifecycle | Run IDs, status, cancellation, branch-local checkpoints and visible widgets | Users should not need repeated polling prompts to know whether work is still active |
| Cheap supervision | Event-driven telemetry with optional public-note synthesis | One small bounded call beats replaying the full context into the primary model for each status request |
| Honest exits | Partial artifacts, explicit failures, budget stops, no automatic retries | A failed or unverified run must not masquerade as completion |
| Human checkpoints | Consent before disclosure/spending; main Pi retains implementation and verification | Keeps the existing SCUD/SB boundaries rather than bypassing them via unrestricted child workers |

## Important departures

1. **Tool-less V1.** Grok's full subagent capabilities and Ultracode's autonomous edits are not adopted yet. No child filesystem/shell access means an advisory reviewer cannot mutate the evidence, bypass guard-file protections, or silently take over task ownership.
2. **Unknown does not mean cleared.** A skeptic can challenge an unsupported defect, but unresolved serious risks remain visible. We do not translate default-to-refuted into automatic merge permission.
3. **No geographic dedupe pretending identity.** This version does not discard findings merely because they mention nearby lines; separate defects may occupy the same location. Synthesis must preserve disagreements and evidence gaps.
4. **No silent paid polling.** Timers start only on user activation, coalesce unchanged state, have a call ceiling and an admission budget, and pause on error/lifecycle changes.
5. **No unbounded context inheritance.** Workflows consume explicit evidence; the observer consumes telemetry or opted-in public notes. No raw transcripts, thinking streams, automatic repo scans or cross-project memory consolidation.
6. **No full compatibility promise.** The workflow graph is a small declarative format, not a JavaScript Ultracode interpreter, durable external job server, or autonomous coding swarm.

## Evaluation

Tests exercise scheduling, dependency validation, schema failures, checkpoint resume, role routing, budget admission, cancellation, consent races, branch changes, observation coalescing, redaction, and instant status handling. Real Pi RPC tests verify discovery and no-model status commands. Inference tests use explicit test doubles; they do not spend money or claim live-model quality evaluation.

Live-model quality/cost testing needs an explicitly selected provider/model and an agreed data scope. Cross-model agreement and operator usefulness should be evaluated before expanding to tool-using coding workers.
