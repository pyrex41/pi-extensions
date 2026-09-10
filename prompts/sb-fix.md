---
name: sb-fix
description: Inspect and resolve Shen-Backpressure gate failures
---

For an explicitly configured SB project, run `sb` op `context`, then `sb` op `gates`. Resolve failures before continuing implementation. Follow the manifest's actual spec/output paths; never hand-edit generated guards. If SB is unconfigured, report that rather than creating scaffolding or activating nested sketches without approval.
