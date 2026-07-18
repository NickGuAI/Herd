# Issue #1946 — sub-agent activity ownership and lifecycle

Date: 2026-07-10

## Scope

- PR feedback: <https://github.com/NickGuAI/Herd/pull/1945#issuecomment-4938509093>
- Delivery issue: <https://github.com/NickGuAI/Herd/issues/1946>
- Target branch / PR: `dev` / <https://github.com/NickGuAI/Herd/pull/1945>

The Command Room must count distinct sub-agent owners separately from their nested tool calls, keep each owner's calls ordered and isolated under that owner, and stop showing stale owners as running after a provider runtime ends, restarts, or enters credential recovery.

## Implementation evidence

- `projectAgentActivity` builds the display projection from durable `transcript.subagentId` ownership first, merges duplicate owner fragments, deduplicates nested calls, and preserves unowned details for inspection.
- `AgentActivityGroup` renders the owner count and descendant call count separately. Each owner row expands independently and reports its own running, succeeded, or failed state.
- Runtime lifecycle boundaries recursively terminalize running activity and clear active owner correlations before a replacement runtime starts. Terminal replay state remains authoritative over richer stale running rows.
- Claude process-exit activity carries an explicit `runtime.end` lifecycle marker.

## Verification

- Focused activity/history/stream tests: 4 files, 109 tests passed.
- Claude process-exit route regression: 2 matched tests passed.
- Command Room regression bundle: 7 files, 76 tests passed.
- Channel-impact regression bundle: passed; channel transport and binding behavior were not changed.
- Runtime-session regression bundle: 12 files, 132 tests passed.
- Full Herd suite on the final diff: 375 files passed, 1 skipped; 2,733 tests passed, 13 skipped.
- `pnpm --filter herd run docs:check`: passed.
- `pnpm --filter herd run lint`: passed.
- `pnpm --filter herd run build`: passed (existing chunk and dynamic-import warnings only).
- `pnpm --dir apps/herd exec tsc -p tsconfig.node.json`: passed.
- `git diff --check`: passed.
- Root `make fmt`: passed (`No root formatter configured; skipping fmt.`).
- Root `make test`: passed on the final diff — 375 files passed, 1 skipped; 2,733 tests passed, 13 skipped.
- Root `make lint`: passed.

The first root-suite attempt produced one nondeterministic failure in unrelated `OperatorCard.test.tsx` after the same complete suite had passed. The isolated test immediately passed, and the complete root rerun passed.

The independent drift audit initially found that a sub-agent-scoped `turn.end` could settle parallel owners. The reducer now scopes sub-agent `turn.start` and `turn.end` handling to the correlated owner while preserving global settlement for main/runtime boundaries. Two-owner start/end regressions pass, and the final independent verdict is `PASS` with no remaining P0/P1 findings.

## Visual check

A temporary Vite harness was inspected in desktop and 390px mobile layouts, then removed. It showed:

- `3 sub-agents · 90 tool calls` for three owners with thirty calls each;
- independent succeeded, failed, and running owner states;
- expansion of one owner containing only its ordered `research-east/...` calls;
- clean mobile wrapping.

Local screenshots (not committed):

- `/tmp/herd-subagent-ui.png`
- `/tmp/herd-subagent-expanded-ui.png`

## Operational boundary

No deployment, server restart, production credential mutation, or live conversation mutation was performed for this UI/lifecycle delivery.
