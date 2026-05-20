---
name: legion-investigate
description: Investigate a bug, failure, or unclear behavior and turn it into root cause plus an execution-ready issue plan.
user-invocable: true
argument-hint: "<problem description, URL, or file path>"
---

# Investigation

Use this skill before implementation when the root cause is not proven.

Output:

- Reproduction or observed evidence.
- Root cause in the owning layer.
- A fix plan that preserves invariants.
- Verification plan.
- Open questions only where truly blocking.

Prefer source reads, logs, and tests over guesses.
