export const SB_TOOL_DESCRIPTION = `Run Shen-Backpressure for an explicitly configured, trusted project.
Requires sb.toml at cwd or an ancestor within the repository, with [paths] spec and output. Never auto-activate nested sketches or initialize without user approval.

Operations: context (format markdown/json, evidence optional); gates; gen; derive (regen optional); audit; init (lang go/ts, no Claude skills).
Read the manifest/context for actual gate names and spec paths; do not assume a fixed five-gate pipeline or specs/core.shen.
Failures throw real Pi tool errors. Only gates can establish verification success. context/audit/gen cannot clear a failed gate status.
Generated output is protected from edit/write. done/commit require successful gates matching current file contents; any shell/edit/write invalidates cached success conservatively.
Gate commands are trusted project code. Hooks do not sandbox bash, standalone git/SCUD, or external writers. Finish the user task only after resolving gate failures.
Output is bounded to 24 KiB/950 lines (tail); earlier excess output is discarded, not persisted in a raw log.`;

export const METHODOLOGY_SECTION = `
<Shen_Backpressure>
This project has an SB manifest. Use sb op:context for its actual proof chain, paths and gates.
Use guard constructors at boundaries; never hand-edit generated guards or bypass validation.
Run sb op:gates before completing or committing work, and fix failures before continuing.
Pi protects generated output from edit/write and gates SCUD done/commit using content fingerprints.
These workflow checks are not a sandbox for arbitrary shell commands or external processes.
</Shen_Backpressure>
`;
