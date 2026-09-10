export const TODO_TOOL_DESCRIPTION = `Project-local SCUD DAG todo list. Tasks live in .scud/ (not session memory). Reference tasks by their SCUD id (1, 1.2, 1.2.1), never by invented slugs.

A task is ready when status is pending and every dependency is done. scud next returns the highest-priority ready task. Completing a task unblocks dependents.

## Operations

| op | Fields | Effect |
|---|---|---|
| init | items?: string[], tag? | scud init, set active tag (default main), optionally create those titles |
| warmup | — | Session orientation: tag, stats, next task (JSON) |
| next | tag? | Next ready task |
| list | status?, tag? | List tasks (JSON) |
| show | id, tag? | Task details (JSON) |
| start | id, tag? | set-status in-progress |
| done | id, tag? | set-status done |
| drop | id, tag? | set-status cancelled |
| append | title or items[], tag?, priority?, complexity? | Create task(s) |
| stats | tag? | Phase statistics |
| waves | tag? | Parallel execution waves |
| commit | message? | Task-aware git commit, prefixes [TASK-ID] |
| tags | tag? | List tags, or set active tag |

Statuses: pending, in-progress, done, blocked, failed, review, expanded, deferred, cancelled.

## Rules
- On multi-step work: warmup or list first, then start the ready id, do the work, done immediately.
- NEVER make a todo call the turn's only tool call — batch start/done with the real reads/edits.
- Prefer next over guessing which task is unblocked.
- Do not keep a parallel in-memory checklist. SCUD is the source of truth.
- If .scud is missing, init before any other op.`;

export const TASK_MANAGEMENT_SECTION = `
<Task_Management>
## SCUD Todo (CRITICAL)

Use the todo tool for multi-step work. It is the SCUD DAG in this repo: hierarchical ids, dependencies, waves, and statuses on disk under .scud/.

${TODO_TOOL_DESCRIPTION}

## Evidence
- File edit: inspect the changed files and diagnostics.
- Build command: require exit code 0.
- Test run: require passing output, or state the pre-existing failure.
- Task done: only after the evidence above, then todo op:done with that id.
</Task_Management>
`;
