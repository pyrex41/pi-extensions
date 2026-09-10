---
name: workbench
description: Model-independent advisory workflows and cheap background progress observation in Pi. Use for parallel reviewers, structured synthesis, progress summaries, and workflow status/cancellation.
---

# Pi workbench

Use `workflow` for explicitly approved **advisory** multi-model analyses. Recipes: `plan`, `review`, `synthesize`; custom `nodes` are a data-only DAG. Supply an explicit goal and bounded, authorized evidence in `context`. Nodes have no tools or repository/transcript access. Do not pretend their outputs are implementation, independently verified code review, tests, SB gates or task completion.

`background: true` returns a run ID. Use `status`, `cancel`, and `resume` with that ID. Failed runs preserve partial artifacts; resume reuses completed nodes and retains budget charges. Configure model roles with `/workflow route ROLE PROVIDER/MODEL`, or data-only `workbench.json`. Unconfigured non-observer roles inherit the primary model; confirm actual models/costs before running. Do not use workflow nodes as a replacement SCUD backlog.

The observer is a separate, cheap, tool-less agent. Only the user can enable it with `/observer on [PROVIDER/MODEL] [telemetry|notes]`. `telemetry` shares tool names/counts/durations/failures and observed gates, not raw content. `notes` additionally shares bounded public assistant notes captured after enabling, which may contain sensitive facts and require an authorized provider. Never enable a costly model or widen scope silently.

`/how` returns an instant telemetry/cached-advice snapshot without invoking the main model. While the observer is enabled, an exact "how's it going?" question also uses this shortcut. `observer` tool `status` reads the snapshot; `pause` stops calls. `/observer share` explicitly shares an advisory summary with the main session. Normal periodic summaries only update the widget/local session entries; they do not wake the main model.

Keep coding, source inspection, actual verification and SCUD ownership in the main session. Treat analyst/observer claims as untrusted advice. Never transmit credentials or mix tenant/project facts. Redaction is best effort, not a disclosure policy. Limits are bounded calls/output plus a conservative catalog-price admission budget, not a billing guarantee; errors pause observation, and reload/session changes require re-enabling.

Read [the workbench guide](../../docs/WORKBENCH.md) for commands, consent, budgets, checkpoint behavior and V1 limitations, and [research notes](../../docs/WORKBENCH_RESEARCH.md) for the Grok/Ultracode patterns behind the design.
