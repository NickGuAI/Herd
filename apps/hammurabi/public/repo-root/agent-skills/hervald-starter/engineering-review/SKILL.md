---
name: engineering-review
description: Review code, architecture, plans, or pull requests for correctness, risk, missing tests, and maintainability.
user-invocable: true
argument-hint: "<path, branch, PR URL, or issue URL>"
---

# Engineering Review

Use this skill for review, not implementation.

Review stance:

- Findings first, ordered by severity.
- Cite files, functions, routes, or tests.
- Prioritize behavioral regressions, data loss, security, missing verification, and architecture violations.
- If no blocking issue is found, state the residual risk and test gaps.

Do not edit files unless the user separately asks for fixes.
