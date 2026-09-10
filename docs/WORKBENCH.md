# Model-independent workflows and background progress

These are Pi-native additions, not wrappers around Grok/Claude accounts. They use **Pi's current model registry and provider authentication**, including configured custom/local models. They never handle or store API keys themselves.

This first version is deliberately **advisory**: delegated calls have **no tools**, no filesystem access and no recursive agents. Coding, shell commands, SCUD claims and SB verification stay with the main Pi session. It is not yet an autonomous implementation swarm or a full Grok Build/Ultracode runtime clone.

## The "how's it going?" observer

```text
/observer on
```

Select a cheap model from the available-model picker, then approve its scope and limits. Or select an exact registered model:

```text
/observer on PROVIDER/MODEL telemetry
/observer on PROVIDER/MODEL notes
/how
/observer status
/observer share
/observer off
```

`PROVIDER/MODEL` is a placeholder: use an actual ID from `/workflow models` (Haiku, a locally registered Luna, or another provider). The observer **never silently defaults to the expensive primary model**.

### What you get

- A small live widget: observed activity, failures, active tools, and budget usage.
- A periodically refreshed summary: what appears to be happening, risks, and the next useful check.
- `/how`: an instant current telemetry/cached-advice snapshot, without calling the main model.
- While enabled, exact phrases such as **"btw, how's it going?"** are handled the same way. Longer requests and messages with attachments still go to the main agent.
- A warning when the observer reports a new blocker or pauses due to an error/budget limit. Its claims are explicitly advisory.
- `/observer share` deliberately adds a snapshot to the main session's context, without starting a model turn.

Ordinary background summaries **do not enter the main model's context or wake it up**. They update the widget and session-local custom entries instead. This avoids an expensive agent responding to every cheap-agent update.

### What it sees

**`telemetry` (default):** tool names, counts, durations, failures, activity state, and explicitly observed SB gate status. No filenames, commands, file contents, tool arguments/results, user messages, system prompt or thinking. A successful shell tool is not evidence that tests passed.

**`notes` (explicit opt-in):** the same telemetry plus the last four bounded **public assistant notes**, captured only after enabling. Notes are reported claims, not independently verified facts. They can contain code, client facts or other sensitive information quoted by the primary agent: use only a provider authorized for that project. This is not a full transcript feed.

It does not scan files, poll external services, summarize other sessions, consolidate cross-project memory, or write recommendations into source/AGENTS.md. No external provider is enabled just because a project configuration file exists.

### Cadence and lifecycle

Default limits per activation:

- At most one request every **90 seconds**, only when evidence changes.
- At most **40 calls**, with a **$0.25 catalog-price admission budget**.
- **500 output tokens** and a **30-second deadline** per call.
- One request at a time; intermediate events coalesce.
- No paid heartbeat when idle/unchanged. A long quiet interval during active work gets one additional waiting check, not an endless loop.
- Invalid JSON, provider errors, timeouts and budget exhaustion pause the observer rather than retrying silently.
- `/observer off`, shutdown, reload, `/new`, `/resume`, fork and tree navigation stop/pause observation. Re-enable explicitly in the new context. Late replies cannot update another branch/session.

The widget still updates from local events between model calls. `/how` includes the timestamp of the evidence snapshot behind the last model summary, so old advice is not presented as a fresh review.

## Advisory workflow runner

The main agent may use the `workflow` tool with:

```json
{
  "op": "run",
  "recipe": "review",
  "goal": "Review these changes for failure cases",
  "context": "Explicit, bounded evidence selected for the approved reviewers",
  "background": true
}
```

The user confirms the selected models, disclosure scope, call count and admission budget before execution. No repository files or transcript are read automatically. The confirmation reports evidence size; inspect the tool's supplied evidence before approving, especially for cross-provider use.

Tool operations: `run`, `status`, `cancel`, `resume`. Background runs return an ID immediately; status/cancel/resume use that ID. Blocking runs throw actual Pi tool errors on failure, with completed artifacts available for inspection.

Commands:

```text
/workflow models
/workflow route planner PROVIDER/MODEL
/workflow route reviewer PROVIDER/MODEL
/workflow route skeptic PROVIDER/MODEL
/workflow route synthesizer PROVIDER/MODEL
/workflow run plan Implement a bounded retry policy
/workflow status
/workflow status FLOW-ID
/workflow cancel FLOW-ID
/workflow resume FLOW-ID
```

Command-launched runs are background jobs. They announce completion with an advisory report but **do not start a primary-model turn**. `run` commands supply a goal only; meaningful code review requires explicit evidence through the tool. These are not independent repository-reading subagents.

Non-observer roles inherit the active primary model unless configured/routed otherwise; the approval dialog identifies every effective model. The observer always requires an explicit choice. Unknown/unavailable models fail instead of falling back silently. Role routes are session-branch-local; changing a route does not reroute a run already in progress.

### Recipes

| Recipe | Shape | Calls |
|---|---|---:|
| `plan` | planner → skeptic → synthesis checkpoint | 3 |
| `review` | correctness/security/tests reviewers → skeptic → synthesis | 5 |
| `synthesize` | evidence summary → challenge → revised summary | 3 |

Reviewers receive separate charters. The skeptic sees candidate claims rather than grading its own work. All stages return validated JSON: a summary, evidence-linked findings, unresolved questions and suggested next checks. Model consensus is **not** a substitute for a test, SB gate or human approval.

### Custom data-only DAGs

Instead of `recipe`, supply `nodes`:

```json
[
  {"id":"facts","role":"planner","instructions":"Extract facts and unknowns from supplied evidence.","dependsOn":[]},
  {"id":"risks","role":"reviewer","instructions":"Identify unresolved risks, not style nits.","dependsOn":[]},
  {"id":"challenge","role":"skeptic","instructions":"Challenge the facts and missing context.","dependsOn":["facts"]},
  {"id":"summary","role":"synthesizer","instructions":"Synthesize and preserve disagreement.","dependsOn":["facts","risks","challenge"]}
]
```

At most 12 nodes and 4 concurrent requests (default 2). Duplicate IDs, missing references, cycles and observer-role nodes are rejected. Nodes become runnable as soon as **their own** dependencies finish: an unrelated slow reviewer does not force a global wave barrier.

No JavaScript evaluation or arbitrary executable workflow files are supported. Workflow nodes are inference steps, **not a second task backlog**; use SCUD for project tasks and their ownership/dependencies.

### Checkpoints and honest exits

Every stage checkpoints into the current Pi session branch. Resume reuses completed nodes and retries only unfinished work. Reserved charges and call counts survive resume; reload never automatically resumes paid work. Cancellation/failure retains partial artifacts and does not mark the workflow complete. One run per session, with at most ten recent runs retained in the in-memory index.

A completed workflow means **the requested analyses finished**. It does not mean source was implemented, tests passed, a review finding was independently proven, or a SCUD task was completed. There is no automatic code application, task status mutation, commit, PR merge, or release.

## Configuration

Optional user configuration: `~/.pi/agent/workbench.json`. A trusted project's `.pi/workbench.json` overrides it **at the current cwd**. Configuration is data-only, size-limited and validated; no `enabled` field is accepted.

Example limits (no model/provider is selected by this example):

```json
{
  "roles": {},
  "observer": {
    "scope": "telemetry",
    "intervalSeconds": 90,
    "maxCalls": 40,
    "maxEstimatedCostUsd": 0.25,
    "maxTokens": 500,
    "timeoutMs": 30000
  },
  "workflow": {
    "concurrency": 2,
    "maxCalls": 12,
    "maxEstimatedCostUsd": 2,
    "maxTokens": 1200,
    "timeoutMs": 60000
  }
}
```

Populate `roles.observer`, `roles.planner`, `roles.reviewer`, `roles.skeptic` and `roles.synthesizer` with actual `provider/model` IDs if desired. **Never place credentials here.** Use Pi's provider/auth configuration normally.

Headless activation requires the user's explicit `--allow-observer` / `--allow-workflow` CLI flag in addition to a requested command/tool invocation. Neither flag starts background spending by itself.

## Cost and privacy limits

- Admission reserves a conservative text-token estimate plus the output cap before each call. Parallel stages share that run's ledger. Reservations are not refunded, including on timeout/error; reported costs above a reservation increase its charge. This can stop a run before the estimated dollar ceiling is actually spent.
- Catalog prices, token estimates, caching, OAuth/subscription billing and custom-provider usage can differ. **The dollar limit is not a provider billing guarantee.** Zero catalog prices can mean missing pricing rather than free inference. The call/output caps still apply.
- Budgets are per workflow run / observer activation, not a global monthly spending limit. Explicitly starting another run/activation creates another budget.
- Ledgers show reported token usage and conservative reserved/charged estimates. Successful blocking workflow tools report nested usage to Pi; `workflow status` with an ID collects any unreported usage exactly once (including background/partial runs). Slash-command-only runs and observer calls retain their own ledgers until collected; observer usage is separate from the native primary-session total. Do not mistake the primary footer for the whole bill.
- Abort signals and deadlines stop local waiting and request transport cancellation. A provider that ignores cancellation may still finish/bill a request. Errors pause the observer; there is no retry storm.
- Common token/header/query-key forms, private-key blocks and known secret environment values are redacted; input/output is bounded. **This is best-effort hygiene, not DLP.** User-selected workflow evidence and opted-in public notes must already be appropriate for the chosen provider.
- API keys are resolved inside Pi's model registry and never copied into prompts, configuration, checkpoints or error reports. Raw provider exceptions are withheld because they may contain headers or payloads.

## Future work, deliberately not implied by V1

Worktree-isolated coding workers, safe patch application, standing CI/log monitors, evidence-file collectors with access policy, external task messaging, provider-independent resumable tool-using agents, and project-scoped learned memory. Those need additional permissions and evaluation; this version does not pretend to provide them.

See [research and design rationale](WORKBENCH_RESEARCH.md) for the source patterns and tradeoffs.
