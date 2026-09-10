# pi-extensions

Pi coding-agent extensions for [SCUD](https://github.com/pyrex41/scud) and [Shen-Backpressure](https://github.com/pyrex41/Shen-Backpressure).

This package follows the same shape as [pi-todotools](https://github.com/code-yeongyu/pi-todotools): one op-based `todo` tool, a sidebar widget, prompt guidance, and a `/todos` command. The list is not session-local. It is the project's SCUD DAG.

Shen-Backpressure is a second extension: an `sb` tool plus `/sb` and `/sb-gates`, injecting live `sb context` when `sb.toml` is present.

## Install

Requires the `scud` and `sb` CLIs on `PATH` (or `SCUD_BIN` / `SB_BIN`). Pi 0.85+.

```bash
# from a local checkout (no npm install; Pi loads TypeScript in place)
pi install /absolute/path/to/pi-extensions

# from git
pi install git:github.com/pyrex41/pi-extensions
```

Pi already provides `@earendil-works/pi-*` and `typebox` at runtime. They are optional peerDependencies so `pi install git:…` does not download the Pi SDK into the clone.

Remove any other extension that owns the `todo` tool name first:

```bash
pi remove <the-other-todo-extension>
```

## SCUD todo

The `todo` tool shells out to `scud -C <cwd>`. Ops map to the MCP core set plus waves/tags/init:

| op | scud |
|---|---|
| `init` | `scud init` (+ optional `create`) |
| `warmup` | `scud warmup --json` |
| `next` | `scud next` |
| `list` / `show` / `stats` / `waves` | JSON forms |
| `start` / `done` / `drop` | `set-status in-progress` / `done` / `cancelled` |
| `append` | `scud create --title` |
| `commit` | `scud commit` |
| `tags` | `scud tags` |

`/todos` prints warmup + list. The sidebar widget shows tag, counts, and the next ready task.

## Shen-Backpressure

| op | sb |
|---|---|
| `context` | `sb context -format markdown` |
| `gates` | `sb gates` |
| `gen` | `sb gen` |
| `derive` | `sb derive` (`regen: true` → `-regen`) |
| `audit` | `sb audit-report` |
| `init` | `sb init -config -no-skills` |

When `sb.toml` exists, each agent turn gets the methodology block plus live `sb context`. Failures are backpressure: fix the gate before new work. Do not edit generated guard files.

Headless Ralph loops stay on `sb loop` (`RALPH_HARNESS` can point at `pi -p`). This package is the interactive surface.

## Layout

```
extensions/scud/                 todo tool, widget, /todos
extensions/shen-backpressure/    sb tool, /sb, /sb-gates
skills/                          pi skills
prompts/                         /scud-next, /sb-gates templates
```

## Tests

```bash
npm test
```
