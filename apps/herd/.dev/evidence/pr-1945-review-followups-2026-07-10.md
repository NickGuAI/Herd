# PR #1945 — global Claude recovery contract and review follow-ups

Date: 2026-07-10

## Scope

- Delivery PR: <https://github.com/NickGuAI/Herd/pull/1945>
- Target branch: `dev`
- Related issues: #1942, #1943, #1946, #1947

This change completes the single-global-slot Claude contract and the actionable
review feedback on PR #1945. It does not deploy Herd or mutate any live
credential or conversation.

## Approved runtime contract

```text
credential pool
      |
      v
serialized global coordinator ---> ~/.claude ---> every local Claude conversation
      ^                                  |
      |                                  |
      +-------- actual runtime limit ----+
                    |
                    v
       fresh target -> recent cached target -> unknown ready target
                    |
                    v
        activate globally, then retry the same conversation in place

quota inspection HTTP 429
      |
      +--> inspection refresh throttled
      +--> preserve last-good remote quota
      +--> keep account available
      +--> never label account quota exhausted
```

Fresh five-hour utilization remains usable through 99%. Only a fresh 100%
snapshot can proactively rotate an account. Cached data never initiates a
proactive rotation, but a recent cached snapshot with headroom may be used to
recover from an actual runtime failure. If every inspection is unavailable, a
ready account with unknown quota is the last reactive recovery choice.

## Quota authority and persistence

- Provider usage data is the quota source of truth.
- Manual `Refresh quota` and `Refresh all` force and await provider checks,
  persist the completed result, return the completed pool DTO, and immediately
  replace the Settings query cache.
- Automatic polling is non-force and honors provider backoff.
- HTTP 429 from quota inspection records a refresh-throttled error separately
  from account quota state and preserves the last-good windows.
- Last-good quota is persisted at the configured data directory under
  `credential-pools/claude/quota-cache.json` without tokens or raw provider
  responses. Atomic writes use mode `0600`.
- Cache reads are bounded and fail closed for oversized, malformed, future,
  partial, or out-of-range data.
- Cached recovery eligibility expires after 15 minutes. A recent cached 100%
  account remains excluded; an expired snapshot becomes unknown and is
  considered only as the last reactive fallback.
- A credential revision fingerprint is captured around the provider request.
  If login rewrites the credential while a refresh is in flight, the stale
  response is discarded rather than overwriting the new account's state. The
  full revision is also persisted, so a replacement with preserved `mtime`
  invalidates the previous account's cached quota after restart.
- Missing tokens and provider 401/403 responses clear persisted quota for that
  credential.

## Review follow-ups

- Failed reactive activation no longer abandons an otherwise recoverable
  conversation; the coordinator excludes the failed target, applies the same
  fresh → cached → unknown ranking to the remaining accounts, and retries the
  same conversation after successful global activation.
- Explicit isolated-runtime Claude sessions are excluded from global teardown
  and reload paths. Legacy sessions with no mode remain global-continuity.
- A late `auth_required` from an old process reloads only that conversation
  onto the already-current global credential when no new switch is needed.
- If the managed global Claude OAuth file disappears, synchronization
  transactionally reinstalls the active pool account while preserving unrelated
  credential-file sections.
- Scoped weekly quota eligibility now respects the scoped reset window.
- Recovery reasons survive SQLite runtime-session persistence.
- The desktop Command Room resolves its remote host consistently with the
  other conversation surfaces.
- The development launcher, Vite proxy, and onboarding CLI respect a custom
  Herd port instead of assuming the historical development port.
- Earlier review fixes in the PR serialize global activation before spawn,
  validate startup state, preserve enriched recovery metadata, keep isolated
  local spawns on the active global credential, and restart Caddy safely.

## Verification

- Core quota/coordinator/global-runtime/credential-store bundle: 110 tests
  passed.
- Runtime-session bundle: 136 tests passed.
- Channel-path bundle: 183 tests passed.
- Provider bundle: 200 tests passed, 11 skipped.
- Responsive UI bundle: 138 tests passed.
- Release bundle: 28 tests passed.
- Launcher bundle: 8 tests passed.
- Herd CLI suite: 294 tests passed.
- Full Herd suite: 377 files passed, 1 skipped; 2,765 tests passed,
  13 skipped.
- `make fmt`: passed (`No root formatter configured; skipping fmt.`).
- `make lint`: passed.
- `pnpm --filter herd run build`: passed (existing chunk and
  dynamic-import warnings only).
- `pnpm --dir apps/herd exec tsc -p tsconfig.node.json`: passed.
- `pnpm --filter herd run docs:check`: passed.
- `pnpm --filter herd run db:ready`: passed.
- Herd cleanliness check: passed.
- `git diff --check`: passed.

The full suite emitted existing React `act(...)`, jsdom canvas, and fixture-log
warnings; it completed successfully. No claim of a warning-free run is made.

## Independent drift audit

The frozen diff received a final `PASS` with no remaining P0/P1/P2 drift. The
first pass found two P1 gaps before delivery: failed reactive activation fell
back to the fresh-only polling path, and restart cache invalidation persisted no
credential revision. Both were corrected with failing-first regressions. The
final audit verified the complete approved contract, all twenty PR review
threads, the final verification evidence, and exclusion of unrelated Tavily
work.

## Channel Critical Review Packet

- Owner: Codex
- Classification: channel-impacting yes
- Reason: shared runtime-session persistence and recovery state are used by
  channel-backed conversations, although no provider-specific channel behavior
  changed.
- Change type: shared Claude runtime recovery / session persistence
- Same-turn external peer: `peer-1` in the local channel fixture.
- Same-turn conversation ID: fixture-generated conversation identity asserted
  by the channel-path test bundle.
- Same-turn assistant reply text: fixture reply asserted by the existing
  channel-path tests; outbound reply construction was not changed.
- Provider adapters: checked; no provider-specific channel adapter changed.
- Channel binding and session key: checked; no account binding, route binding,
  `sessionKey`, or surface identity behavior changed.
- Channel ingest: checked; no channel ingest route changed.
- Conversation runtime: shared persisted recovery-reason shape changed; the
  runtime-session and channel-path bundles passed.
- Event schema and transcript projection: checked; unchanged.
- Outbound dispatch and delivery status: checked; unchanged.
- Desktop and mobile transcript rendering: checked through the responsive UI
  bundle; no channel transcript component behavior changed.
- Relaunch/runtime health: N/A because this delivery explicitly makes no
  deployment or live server restart.
- Live external provider send: N/A because no channel provider behavior changed
  and no live outbound action was authorized.
- Manual live conversation continuation: N/A because no production credential
  or conversation mutation was authorized.
- Test evidence: channel-path bundle 183 passed; full Herd suite 2,765
  passed and 13 skipped.

## Operational boundary

No deployment, server restart, live credential copy, provider login, remote
quota request, or live conversation mutation was performed.
