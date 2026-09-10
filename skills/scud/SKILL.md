---
name: scud
description: SCUD DAG tasks in opted-in projects. Use for task progress, ready work, dependency edges, claims, or status updates.
---

# SCUD for Pi

Use the `todo` tool for an existing SCUD project. Do not initialize task scaffolding during unrelated work. `init` requires user confirmation; headless initialization needs the user's `--allow-scud-init` flag. Pi installs only `.scud/`, not skills for other agents.

Workflow: `warmup` → `next` → `start` with the ready ID → work → verification → `commit` if requested → `done`. Commit **before** done. Do not make a parallel task list.

`start` checks pending status and effective dependencies, then claims the task for this Pi session. Another Pi session cannot start or complete that claim. `release` resets your task to pending. `/scud-release TAG ID` recovers an abandoned claim with human confirmation after the old worker has stopped.

`dependencies` takes `id`, optional `tag`, and a replacement array of phase-local dependency IDs. `[]` clears edges. Only pending, unclaimed tasks can change; unknown IDs and cycles are rejected. Use `append` first to create tasks, then connect the returned IDs.

`commit` requires `id` and ownership; specify `tag` when ambiguous. It commits already-staged files with `[tag:id]`, never arbitrary first-in-progress task selection or automatic staging. In an SB-configured project, `done`/`commit` require passing gates for current contents.

`list`, `show`, `stats`, `waves`, `tags` inspect the DAG. `tags` with `tag` selects a phase. `/todos` puts a bounded report in the transcript and model history.

Pi mutation locks coordinate **only Pi sessions**, not standalone SCUD/swarm writers. Never mix those writers concurrently. SCUD's dependency conversion uses its own serializer; stop external writers first. CLI-only heavy/swarm operations remain available through bash when needed, outside Pi mutation activity.

Project configuration is discovered from cwd/ancestors within the repository, not from nested sketches. Large output is bounded; prefer `show` or filtered `list` over inspecting raw task storage. For details and limitations, see [the package README](../../README.md).
