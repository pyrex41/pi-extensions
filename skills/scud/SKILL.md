---
name: scud
description: SCUD DAG task management for the pi coding agent. Use when the user asks about tasks, progress, the next task, waves, or wants to update task status.
---

# SCUD Task Management

SCUD organizes work as a directed acyclic graph of tasks with dependencies, priorities, and Fibonacci complexity. The `todo` tool in this package is the interface — do not shell out to `scud` unless the tool cannot express the operation.

## Workflow

1. **Orient**: `todo` op `warmup`
2. **Claim**: `todo` op `start` with the ready id
3. **Implement**: do the work (batch the start/done call with real edits)
4. **Commit**: `todo` op `commit` (prefixes `[TASK-ID]`)
5. **Complete**: `todo` op `done`
6. **Repeat**: `todo` op `next`

## Ready tasks and waves

A task is ready when its status is `pending` and every dependency is `done`. `todo` op `waves` groups ready work into parallel batches (Kahn topological sort). `todo` op `next` is the highest-priority ready task.

## Statuses

`pending` | `in-progress` | `done` | `blocked` | `failed` | `review` | `expanded` | `deferred` | `cancelled`

## Tags

Tasks are grouped by tag (phase/feature). `todo` op `tags` lists them; pass `tag` on other ops to override the active tag.

## Heavy / swarm

Deep multi-agent research (`scud heavy`) and parallel wave execution (`scud swarm`) stay on the CLI. Use bash for those; the todo tool covers the interactive coding loop.
