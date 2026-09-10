export const TODO_TOOL_DESCRIPTION = `SCUD task management for opted-in projects. Never initialize task scaffolding without user approval.

Operations:
- init: initialize .scud only (no Claude/OpenCode skills); optional tag (default main), items.
- warmup / next / list / show / stats / waves / tags: inspect the project DAG. show needs id; list accepts status; tag overrides the active phase. tags with tag switches phase.
- append: title or items; optional tag, priority, complexity.
- dependencies: id, tag, dependencies (phase-local IDs; [] clears). Replaces edges on a pending task; rejects unknown IDs and cycles.
- start: id, tag. Claims a ready task for this Pi session. Idempotent for the same owner; rejects other owners and unmet dependencies.
- release: id, tag. Releases your claim and resets to pending.
- done / drop: id, tag. Complete or cancel your claimed task and release ownership.
- commit: id, tag, optional message. Commit already-staged changes with an explicit [tag:id] prefix. Never stages unrelated files. Must precede done.

Claims and mutation locks coordinate Pi sessions only, NOT standalone scud/swarm writers. Do not mix those writers with Pi mutations. /scud-release TAG ID recovers abandoned claims with human confirmation.
In SB-configured projects, done and commit require successful gates for current file contents.
Outputs are bounded to a 24 KiB/950-line tail; use show/filtering for large lists.
Use warmup/next, then start the ready ID, work, commit if requested, and done after verification.`;

export const TASK_MANAGEMENT_SECTION = `
<SCUD>
This project has opted into SCUD. Use the todo tool for multi-step implementation work.
Reference real task IDs; do not invent a parallel task list. Inspect the DAG before claiming work.
Verify changes before done. If committing, commit the explicitly claimed task BEFORE marking it done.
Do not run standalone SCUD/swarm writers concurrently with Pi mutations.
</SCUD>
`;
