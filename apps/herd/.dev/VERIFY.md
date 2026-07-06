# Verification

Run the narrow bundle for the area touched, then run the full gate before
delivery when the change crosses module or release boundaries.

## Cheap Local Checks

```bash
pnpm --filter @gehirn/herd-cli test -- up.test.ts doctor.test.ts workers.test.ts session.test.ts
pnpm --filter herd run db:ready -- --source-root ~/.herd --db ~/.herd/herd.sqlite
pnpm --filter herd run docs:check
make -C agent-skills test
```

No `playwright.config.*` exists under `apps/herd`; use Vitest and manual
desktop/mobile route checks unless a browser test harness is added later.

## Runtime Sessions

Use when touching `server/db/*`, `tools/db-ready.ts`, `tools/migrate-sqlite.ts`,
`modules/agents/session/*`, or session query/control routes.

```bash
pnpm --filter herd exec vitest run \
  server/__tests__/sqlite-readiness.test.ts \
  server/__tests__/sqlite-migration.test.ts \
  server/__tests__/launch-state-reset.test.ts \
  modules/agents/session/__tests__/sqlite-runtime-store.test.ts \
  modules/agents/session/__tests__/persistence.test.ts \
  modules/agents/__tests__/session/state.test.ts \
  modules/agents/__tests__/routes-session-control.test.ts \
  modules/agents/__tests__/session-query-messages.test.ts \
  modules/agents/__tests__/websocket.test.ts \
  modules/agents/__tests__/send-route.test.ts \
  modules/agents/__tests__/queue-state.test.ts \
  modules/agents/__tests__/queue-mutation.test.ts \
  modules/agents/adapters/codex/__tests__/runtime.test.ts

pnpm --filter herd run db:ready -- --source-root ~/.herd --db ~/.herd/herd.sqlite
```

Evidence done: tests pass, `db:ready` reports ready or prints an explicit
remediation command, and API DTOs expose backend `state`/actions without UI
inference.

For restore-latency fixes, also prove the persisted-session reader against a
representative large `runtime_state_json` row and run a production relaunch
check. Evidence should include `operations/scripts/launch_herd.sh`,
`https://herd.gehirn.ai/api/health` reporting the expected commit,
`operations/logs/server/herd/latest/launch.log`, and a quick protected
agents route probe such as `/api/agents/sessions` returning auth failure quickly
instead of hanging.

## Command Room

Use when touching Command Room desktop/mobile shell, conversation hooks, queue,
workspace context, or chat transcript merging.

```bash
pnpm --filter herd exec vitest run \
  modules/command-room/__tests__/chat-pane.test.ts \
  modules/command-room/__tests__/backend-owned-contract-guardrails.test.ts \
  modules/command-room/__tests__/SessionsColumn.test.ts \
  modules/command-room/components/desktop/__tests__/CommandRoom.chat-start.test.tsx \
  modules/command-room/components/mobile/__tests__/MobileCommandRoom.conversations.test.tsx \
  modules/conversation/__tests__/use-conversations-message.test.tsx \
  modules/conversation/__tests__/use-conversations-start-stop.test.tsx \
  modules/agents/__tests__/queue-mutation.test.ts \
  modules/agents/__tests__/MobileSessionShell.test.tsx \
  modules/workspace/components/__tests__/WorkspacePanel-context.test.tsx \
  modules/approvals/__tests__/ApprovalNotificationCenter.test.tsx
```

Evidence done: backend-owned action/state guardrails pass, conversation hooks
mutate expected endpoints, and mobile/desktop shells render without divergent
state rules.

## Channels And External Conversation Surfaces

Use when touching channel provider adapters, channel bindings, channel surface
resolution, inbound external-message ingest, automatic outbound replies, channel
conversation runtime, transcript projection, or channel-visible chat rendering.
Run this bundle even when no `modules/channels/*` file changed if the change
touches session create/resume, queue/send, provider events, conversation message
APIs, transcript projection, shared chat rendering, or Markdown behavior used by
channel conversations.

```bash
pnpm --filter herd exec vitest run \
  modules/channels/__tests__/inbound-roundtrip.test.ts \
  modules/channels/__tests__/outbound.test.ts \
  modules/channels/__tests__/resolver.test.ts \
  modules/channels/__tests__/surface-binding-store.test.ts \
  modules/channels/__tests__/whatsapp-adapter.test.ts \
  modules/channels/__tests__/whatsapp-route.test.ts \
  modules/channels/__tests__/route.test.ts \
  modules/channels/__tests__/useChannels.test.tsx \
  modules/commanders/__tests__/channel-message-routes.test.ts \
  modules/commanders/routes/__tests__/conversation-runtime.test.ts \
  modules/commanders/routes/__tests__/conversation-read-model.test.ts \
  modules/agents/messages/__tests__/history.test.ts \
  modules/agents/components/session-message-list/__tests__/blocks.test.tsx \
  modules/command-room/__tests__/chat-pane.test.ts \
  modules/conversation/__tests__/use-conversations-message.test.tsx
```

Evidence done: inbound messages resolve to the intended commander conversation,
assistant replies dispatch to the external provider, conversation metadata keeps
`channelMeta`, `lastRoute`, `channelReplyIntents`, and `channelReplyDelivery`
coherent, `/api/conversations/:id/messages` projects the same assistant text,
and Command Room visibly renders that text. The evidence must be same-turn
evidence: one external peer, one `conversationId`, and one assistant reply text
traced through transcript JSONL, the message API, external provider delivery,
desktop UI, mobile UI, copy/export, and reply-intent settlement. Do not combine a
passing provider send from one turn with a passing UI projection from another.

If the change touches transcript shape, event normalization, session resume, or
message projection, the evidence must include a schema-v2 transcript-envelope
case. Do not rely only on legacy `message_start`/`result` stream events.
`modules/commanders/routes/__tests__/conversation-runtime.test.ts` should prove
that transcript envelopes trigger `dispatchCommanderChannelReply` with the
exact final assistant text.
For automatic replies, the same suite must also cover durable intent creation
before live-session handoff, missed-forwarder reconciliation, retry while pending,
interrupted claimed-delivery failure, no-text failure, concurrent in-flight
deliveries, and orphan pending delivery slots that must not block newer intents.
If the change touches transcript windows, mixed legacy/v2 ordering, or
latest-message behavior, include `modules/agents/messages/__tests__/canonical-timeline.test.ts`
and a route/read-model check for `/api/conversations/:id/messages`.

Every channel-impacting issue or PR must paste the `Channel Critical Review
Packet` from `apps/herd/.dev/playbooks/channel-impacting-change.md` before
the work is declared done. The packet is the audit record that all critical
pieces were reviewed; this verification bundle is not complete without it.

Manual check required for any production channel fix:

```text
External channel message
        |
        v
Herd conversation reply
        |
        +--> external provider receives exact assistant text
        |
        +--> Command Room transcript shows the same visible text
        |
        +--> copy/export path returns the same raw text
```

Include at least one short plain-text reply that can be misread as Markdown,
such as `2026.`, because raw copy success is not proof of visible rendering.

Production relaunch check required for channel fixes:

```text
health endpoint reports expected version     yes/no:
current launch log inspected                 yes/no:
channel adapter runtime started              yes/no:
provider auth/reconnect errors absent        yes/no:
unhandled rejection or crash restart absent  yes/no:
```

If a supervisor restart leaves the app healthy after an initial crash, the
channel review is still incomplete until the crash is explained, fixed, or filed
as a separate blocking issue with owner and reproduction.

Before declaring done, collect evidence for each distinct observable layer:

```text
provider inbound accepted        yes/no:
surface binding still correct    yes/no:
provider session send/resume     yes/no:
active/no-live relaunch recovery yes/no:
assistant transcript persisted   yes/no:
automatic outbound dispatched    yes/no:
external provider received text  yes/no:
message API projected same text  yes/no:
latest-message order is correct  yes/no:
desktop UI visibly rendered text yes/no:
mobile UI visibly rendered text  yes/no:
copy/export preserved raw text   yes/no:
delivery state recorded          yes/no:
provider runtime health checked  yes/no:
same-turn evidence captured      yes/no:
```

## Install, Release, CLI

Use when touching installers, launch scripts, CLI, or public release sync.

```bash
pnpm --filter @gehirn/herd-cli test
pnpm --filter herd exec vitest run \
  server/__tests__/install-default-skills.test.ts \
  server/routes/__tests__/install-script.test.ts \
  server/__tests__/release-runtime-contract.test.ts \
  server/__tests__/sqlite-readiness.test.ts
node --test operations/scripts/__tests__/launch_herd.test.mjs
bash operations/sops/scripts/check-herd-cleanliness.sh public
```

Evidence done: CLI tests pass, launch script contract passes, release contract
passes, and public cleanliness check has no internal leakage.

## Agents And Providers

Use when touching provider adapters, registry, provider auth, machine auth, or
provider context persistence.

```bash
pnpm --filter herd run generate:provider-registry
pnpm --filter herd exec vitest run \
  server/__tests__/provider-context-migration.test.ts \
  modules/agents/providers/__tests__/http-router.test.ts \
  modules/agents/providers/__tests__/validate-model.test.ts \
  modules/agents/__tests__/provider-auth.test.ts \
  modules/agents/__tests__/routes-provider-auth.test.ts \
  modules/agents/__tests__/machine-auth.test.ts \
  modules/agents/__tests__/machine-credentials.test.ts \
  modules/agents/__tests__/routes-create-session-creator.test.ts \
  modules/agents/__tests__/routes-stream-claude.test.ts \
  modules/agents/__tests__/routes-stream-codex.test.ts \
  modules/agents/__tests__/stream-session-conversation-link.test.ts \
  modules/agents/components/__tests__/NewSessionForm.test.ts \
  modules/agents/components/__tests__/useNewSessionConstraints.test.ts \
  modules/command-room/components/desktop/__tests__/CommandRoom.chat-start.test.tsx \
  modules/command-room/components/mobile/__tests__/MobileCommandRoom.conversations.test.tsx
```

Evidence done: provider context remains serializable, auth routes still gate
correctly, and provider sessions still create/stream/link to conversations.

## Mobile And Desktop UI

Use when touching responsive layout, mobile Command Room, desktop Command Room,
or shared composer/session components.

```bash
pnpm --filter herd exec vitest run \
  src/surfaces/__tests__/surface-invariants.test.ts \
  src/hooks/__tests__/use-is-mobile.coarse-pointer.test.ts \
  src/lib/__tests__/api-base.test.ts \
  modules/agents/__tests__/MobileSessionShell.test.tsx \
  modules/agents/__tests__/MobileSessionView.test.tsx \
  modules/command-room/__tests__/hervald-routing.test.ts \
  modules/command-room/__tests__/chat-pane.test.ts \
  modules/command-room/components/mobile/__tests__/MobileCommandRoom.test.tsx \
  modules/command-room/components/mobile/__tests__/MobileCommandRoom.workspace.test.tsx \
  modules/command-room/components/desktop/__tests__/CommandRoom-context.test.tsx \
  modules/workspace/components/__tests__/WorkspacePanel-context.test.tsx \
  modules/settings/__tests__/MobileSettings.test.tsx
```

Evidence done: mobile routes and shell tests pass, desktop chat tests pass, and
shared workspace/composer behavior is still covered.

## Full Gate

```bash
make fmt && make test && make lint
```

Use this before claiming completion for cross-module, CLI, install, release, or
user-visible workflow changes.

## Manual UI Checks

```bash
pnpm --filter herd run dev
```

Then inspect desktop `/command-room` and mobile-width `/command-room`,
`/command-room/inbox`, and `/command-room/settings`.

For native iOS-affecting changes, use the documented Capacitor path:

```bash
pnpm --filter herd run cap:build
pnpm --filter herd run cap:sync
pnpm --filter herd run cap:ios
```
