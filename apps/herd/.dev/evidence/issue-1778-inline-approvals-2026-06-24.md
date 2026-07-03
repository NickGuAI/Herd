# Issue 1778 Inline Approvals Evidence

Date: 2026-06-24
Branch: `feature/issue-1778-enterprisefr-approval`
Base: `origin/dev`

## Scope

Inline approval unblock for Command Room conversation chats:

- backend pending approval DTOs expose `conversationId`
- frontend normalization preserves `conversationId`, Codex correlation IDs, and command text
- desktop highlights only the conversation row that owns the pending approval
- desktop and mobile render approval cards inline in the affected chat body
- command/raw content remains collapsed by default
- fallback summaries that duplicate raw command previews are suppressed in inline
  cards so raw command text still starts inside collapsed `<details>`

## Local Service Fixture

Used isolated local data under `/tmp/herd-issue-1778-fixture/data`.

Backend:

```bash
PORT=21001 HERD_HOST=127.0.0.1 HERD_DATA_DIR=/tmp/herd-issue-1778-fixture/data HERD_BACKGROUND_RUNTIMES=0 HERD_STOP_ACTIVE_SESSIONS_ON_BOOT=0 pnpm --filter herd run dev:server
```

Frontend:

```bash
pnpm --filter herd exec vite --host 127.0.0.1 --port 5300
```

Playwright captured the app as an API-key/native-style client pointed at `http://127.0.0.1:21001`, leaving the existing local app on `20001/5200` untouched.

Screenshots:

- `apps/herd/.dev/evidence/issue-1778-screenshots/desktop-command-room-inline-approval.png`
- `apps/herd/.dev/evidence/issue-1778-screenshots/mobile-command-room-inline-approval.png`

Browser assertions:

- desktop unaffected chat row: `data-has-pending-approval="false"`, `data-approval-count="0"`
- desktop affected chat row: `data-has-pending-approval="true"`, `data-approval-count="1"`
- desktop inline approval card count: `1`
- desktop visible inline detail labels: `Thread`, `Turn`; no visible `Command` detail outside the collapsed block
- mobile inline approval container count: `1`
- mobile inline approval card count: `1`
- mobile visible inline detail labels: `Thread`, `Turn`; no visible `Command` detail outside the collapsed block
- command details summary exists and the parent `<details>` is not open on desktop or mobile

Backend DTO proof from the local fixture:

```json
{
  "approvalId": "approval-issue-1778",
  "conversationId": "33333333-3333-4333-8333-333333333333",
  "threadId": "thread-issue-1778",
  "turnId": "turn-issue-1778",
  "itemId": "item-issue-1778"
}
```

## Tests

Focused approval suite:

```bash
pnpm --filter herd exec vitest run modules/policies/__tests__/persistence.test.ts modules/policies/__tests__/routes.test.ts modules/agents/__tests__/approval-interface.test.ts src/hooks/__tests__/use-approvals.test.tsx modules/command-room/__tests__/chat-pane.test.ts modules/command-room/components/desktop/__tests__/SessionsColumn-conversations.test.tsx modules/command-room/components/mobile/__tests__/MobileChatView.test.tsx modules/agents/__tests__/MobileSessionShell.test.tsx --reporter=dot
```

Result: 8 files passed, 108 tests passed.

Reviewer-fix regression suite:

```bash
pnpm --filter herd exec vitest run modules/policies/__tests__/routes.test.ts modules/command-room/__tests__/chat-pane.test.ts modules/agents/__tests__/MobileSessionShell.test.tsx --reporter=dot
```

Result: 3 files passed, 69 tests passed.

Conversation pause-settlement stabilization:

```bash
pnpm --filter herd exec vitest run modules/commanders/__tests__/conversation-routes.test.ts --reporter=dot
```

Result: 1 file passed, 56 tests passed.

Full checkpoint:

```bash
make fmt && make test && make lint
```

Result: passed after the reviewer fixes, pause-settlement test stabilization, and full-suite fixture hardening. Herd tests reported 353 files passed, 1 skipped; 2262 tests passed, 13 skipped. Lint exited 0.

Additional full-suite stabilization:

- `modules/commanders/__tests__/conversation-routes.test.ts`: pause helpers now wait for the read model to settle to idle before provider/model patch or restart paths continue.
- `modules/commanders/components/__tests__/WizardChatPanel.test.tsx`: fake WebSocket tests now wait for async ticket setup to create the socket before emitting messages.
- `modules/policies/__tests__/routes.test.ts`: route fixture resets real timers around each test and closes active HTTP connections during teardown to avoid full-suite connection resets from leaked fake timers.

## Channel Impact Review

Channel Critical Review Packet

- Owner: Codex
- Classification: channel-impacting yes
- Reason: touches policy gates, approval DTOs, conversation identity projection, and shared desktop/mobile chat rendering used by channel-backed conversations.
- Change type: policy / transcript-ui / shared chat rendering
- Same-turn external peer: N/A, no real outbound provider send was performed per issue ROE.
- Same-turn conversationId: `33333333-3333-4333-8333-333333333333` in local fixture.
- Same-turn assistant reply text: N/A, this change renders a pending approval card and does not extract or dispatch assistant replies.
- Critical-path inventory:
  - provider adapter/runtime: checked; no files under `modules/channels/<provider>/adapter.ts` or `modules/channels/runtime-manager.ts` changed.
  - channel binding: checked; no channel account config, enabled-state, or default-commander binding code changed.
  - surface binding/sessionKey: checked; no `surface-binding-store`, `surface-key`, `lastRoute`, or `sessionKey` code changed.
  - channel ingest route: checked; no `/api/commanders/channel-message` or channel conversation creation route changed.
  - conversation runtime: checked; no create/resume/send queue or channel reply forwarder behavior changed.
  - runtime session state: checked; approval session projections now read existing `session.conversationId`; no session lifecycle behavior changed.
  - provider adapter event schema: checked; no raw event scanner, Codex/Claude event normalizer, or schema-v2 envelope code changed.
  - transcript storage/windowing: checked; no transcript store, canonical timeline, ordering, or compaction code changed.
  - message projection: checked; no `mapStreamEventsToMessages` or transcript projection code changed.
  - outbound reply dispatch: checked; no `channel-dispatchers` or automatic reply dispatch path changed.
  - read model/websocket: checked; no conversation read-model or websocket route code changed.
  - visible desktop transcript: checked by local screenshot and DOM assertions.
  - visible mobile transcript: checked by local screenshot and DOM assertions.
  - copy/export: N/A; this change does not alter copy/export surfaces.
  - delivery status: checked; no `channelReplyDelivery` persistence or rendering code changed.
- Relaunch/runtime health:
  - `/api/health` version: local fixture server started on `127.0.0.1:21001`.
  - launch log inspected: local launch log showed server startup without crash restart.
  - unhandled rejection/crash restart present: no.
  - channel adapter startup result: N/A; `HERD_BACKGROUND_RUNTIMES=0` for screenshot fixture.
- Tests:
  - focused approval suite: 8 files, 108 tests passed.
  - reviewer-fix regression suite: 3 files, 69 tests passed.
  - conversation-route stabilization suite: 1 file, 56 tests passed.
  - full checkpoint: `make fmt && make test && make lint` passed after final reviewer fixes and full-suite fixture hardening.
- Manual/live evidence:
  - desktop screenshot: `apps/herd/.dev/evidence/issue-1778-screenshots/desktop-command-room-inline-approval.png`
  - mobile screenshot: `apps/herd/.dev/evidence/issue-1778-screenshots/mobile-command-room-inline-approval.png`
  - DTO check: local `/api/approvals/pending` exposes `conversationId`, `threadId`, `turnId`, and `itemId`.
- Blocked or not-applicable rows with reason:
  - external provider result: N/A because the issue explicitly forbids real outbound email without operator approval, and this implementation does not change send dispatch.
  - same-turn assistant reply text: N/A because the approval card is rendered before approval resolution and does not dispatch an assistant reply.

The change threads `conversationId` and Codex correlation IDs through policy approval metadata so Command Room can render the approval at the correct conversation. It does not mutate channel dispatchers, channel binding lookup, retry ledgers, provider send paths, or outbound payload construction.

```
Before:

  provider action
       │
       ▼
  approval gate ── pending DTO ──► Command Room
                                  └─ commander-level approval bucket

After:

  provider action
       │
       ▼
  approval gate ── pending DTO + conversationId ──► Command Room
                                                   ├─ matching conversation row highlight
                                                   └─ matching chat inline card

Legend:
  ──► data projection only
  provider action = existing Claude/Codex tool or MCP approval request
```

Preservation checklist:

- `channelMeta`: not changed
- `lastRoute`: not changed
- `surfaceBinding`: not changed
- `sessionKey`: not changed
- `channelReplyDelivery`: not changed
- provider/channel dispatch behavior: not changed
- real outbound channel send during verification: not performed
- approval decision endpoints: existing approve/reject routes reused

Risk notes:

- New `conversationId` is optional for backward compatibility with older persisted pending approvals.
- UI fallback matching still supports exact session-name matches only when `conversationId` is absent.
- Raw command content is shown inside collapsed `<details>` only; it is not expanded by default.
