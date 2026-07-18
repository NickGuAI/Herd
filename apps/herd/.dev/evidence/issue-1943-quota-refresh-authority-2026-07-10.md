# Issue #1943 — authoritative Claude quota refresh

Date: 2026-07-10

## Scope

- Delivery issue: <https://github.com/NickGuAI/Herd/issues/1943>
- Target branch / PR: `dev` / <https://github.com/NickGuAI/Herd/pull/1945>

Anthropic's usage response is the quota source of truth. A quota-inspection
HTTP 429 means the refresh request was throttled; it does not mean the account
exhausted quota. Last-good usage windows must remain visible as cached, and
manual refresh must complete a remote check and update Settings without a
browser reload.

## Corrected flow

```text
Manual Refresh quota / Refresh all
              |
              v
POST waits for remote usage checks --force--> completed pool DTO
              |                                  |
              |                                  v
              +--------------------------> React Query cache

Automatic 90s poll --non-force--> honors Retry-After / nextRefreshAt

Usage HTTP 429 + last-good windows
              |
              +--> quota = cached
              +--> refresh issue = throttled
              +--> credential remains available
              +--> secret-free last-good cache survives restart
```

## Implementation evidence

- Quota failures retain last-good windows as `cached`; `errorCode` separately
  records refresh throttling, network failure, or parse failure. Authentication
  failures remain `auth_required`.
- Explicit operator refresh bypasses local backoff. The automatic 90-second
  poll is non-force and continues to honor the provider retry time.
- The refresh route awaits either one-account or all-account usage checks and
  returns the completed, secret-free pool view with HTTP 200.
- Settings installs that returned DTO directly into the Claude pool query
  cache. A browser force refresh is no longer needed.
- Settings keeps cached percentages and reset times visible, labels the
  snapshot `cached`, and labels the separate failure `refresh throttled`.
  It never presents a 429 as account quota exhaustion.
- A cached last-good account with headroom remains eligible as a failover
  target, while cached data can never initiate a switch away from the active
  account. If a real runtime/auth failure occurs while inspection is entirely
  unavailable, recovery can still try another ready, non-exhausted account.
- Successful quota windows are persisted without tokens or raw provider
  responses, then restored before the first post-restart refresh attempt.
- Fresh 5-hour utilization below 100% remains available. Proactive switching
  starts only at fresh 100% or from an actual runtime usage-limit event.
- Existing fresh 100% overall/scoped weekly eligibility and runtime usage-limit
  behavior remain blocking; those paths were not relaxed.

## Verification

- Core quota/coordinator/global-runtime/credential-store bundle: 110 tests
  passed.
- Full Herd suite: 377 files passed, 1 skipped; 2,765 tests passed,
  13 skipped.
- `make fmt`: passed (`No root formatter configured; skipping fmt.`).
- `make lint`: passed.
- `pnpm --filter herd run build`: passed (existing chunk and
  dynamic-import warnings only).
- `pnpm --dir apps/herd exec tsc -p tsconfig.node.json`: passed.
- `pnpm --filter herd run docs:check`: passed.
- `pnpm --filter herd run db:ready`: passed.
- `git diff --check`: passed.

Initial full-suite attempts exposed timing-only failures in unrelated installer
and heartbeat tests under parallel load, plus an activation-barrier test that
observed only one event-loop tick. The unrelated cases passed independently and
on the final complete run; the activation test now uses a bounded 10 ms
observation interval. No production behavior was changed by that stabilization.

The independent drift audit first found a P1: the automatic poll still passed
`force: true`, which would have bypassed Retry-After along with manual refresh.
The timer now calls non-force refresh, a runtime regression asserts
`{ force: false }`. A later frozen-diff pass found two more P1 gaps in reactive
candidate retry and credential-revision persistence; both received
failing-first regressions and were corrected. The final independent verdict is
`PASS` with no remaining P0/P1/P2 drift.

## Visual check

A temporary Vite harness was inspected on desktop and mobile, then removed. It
showed cached 51% / 16% usage bars, `AVAILABLE`, `CACHED`, and
`REFRESH THROTTLED` together, with explanatory last-successful-remote-quota
copy and no `quota rate limited` account label.

Local screenshots (not committed):

- `/tmp/herd-quota-refresh-desktop.png`
- `/tmp/herd-quota-refresh-mobile.png`

## Operational boundary

No deployment, server restart, production credential mutation, remote quota
request, or live conversation mutation was performed for this delivery.
