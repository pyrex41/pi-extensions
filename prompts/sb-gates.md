---
name: sb-gates
description: Run Shen-Backpressure gates and treat failures as backpressure
---

Run `sb` op `context`, then `sb` op `gates`. If any gate fails, that failure is backpressure: fix it before any other work. Do not edit generated guard files. Change `specs/core.shen` and regenerate if the spec is the cause.
