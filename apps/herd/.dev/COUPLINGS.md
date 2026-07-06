# Couplings

## Runtime Session Ownership

```text
server/db/schema.ts
  -> agent_runtime_sessions
  -> modules/agents/session/sqlite-runtime-store.ts
  -> modules/agents/session/state.ts
  -> modules/agents/routes/session-query-routes.ts
  -> modules/commanders/routes/conversation-read-model.ts
  -> UI + CLI consumers
```

State owner: SQLite/backend runtime session helpers.

Startup gate:

- `apps/herd/modules/agents/routes-core.ts` waits on
  `restorePersistedSessionsReady` before serving agents routes.
- `apps/herd/modules/agents/persistence-helpers.ts` reads SQLite
  persisted sessions before restoring provider sessions.
- `apps/herd/modules/agents/session/sqlite-runtime-store.ts` must keep
  `runtime_state_json` bounded because this read sits on the first
  `/api/agents/*` request after restart.

Consumers:

- UI: `apps/herd/modules/command-room/components/CommandRoom.tsx`,
  `apps/herd/modules/conversation/hooks/use-conversations.ts`,
  `apps/herd/modules/agents/components/*`.
- CLI: `packages/herd-cli/src/session.ts`,
  `packages/herd-cli/src/workers.ts`,
  `packages/herd-cli/src/up.ts`,
  `packages/herd-cli/src/doctor.ts`.
- Install/release: `apps/herd/install.sh`,
  `operations/deploy/ec2/install-ec2.sh`,
  `operations/scripts/launch_herd.sh`,
  `operations/sops/SOP-15-release-herd.md`.
- Transcripts: `apps/herd/modules/agents/transcript-store.ts` stores
  session transcript files alongside runtime session metadata.

Risk: if UI/CLI derives lifecycle instead of rendering backend `state`,
`allowedActions`, and `disabledReasons`, operators can see conflicting state.
Risk: if persisted replay events grow inside `runtime_state_json`, the agents
route startup gate can pin heap and turn post-restart UI clicks into minutes of
latency even though `/api/health` is already green.

## Command Room Composition

```text
command-room/CommandRoom.tsx
  -> commanders hooks/routes
  -> conversation hooks/routes
  -> agents sessions/queues/websockets
  -> workspace panel/context
  -> approvals + automations + quests
```

Command Room stores browser preferences only. Durable data lives in:

- commanders: `apps/herd/modules/commanders/conversation-store.ts`,
  `modules/commanders/store.ts`, `modules/commanders/quest-store.ts`.
- agents: `apps/herd/modules/agents/runtime.ts`,
  `modules/agents/session/state.ts`.
- workspace: `apps/herd/modules/workspace/*`.
- approvals/policies: `apps/herd/modules/approvals/*`,
  `apps/herd/modules/policies/*`.

Risk: changing Command Room without checking route read models can produce UI
state that passes component tests but disagrees with backend action rules.

Conversation-bound chat and standalone agent chat use different send lanes:

- conversation messages: `/api/conversations/:id/message`, read model and
  websocket alias under `apps/herd/modules/commanders/routes/`.
- standalone sessions: `/api/agents/sessions/:name/send`,
  `/api/agents/sessions/:name/ws`, and queue endpoints under
  `apps/herd/modules/agents/`.

## Channel Conversation Surface

```text
external provider event
  -> modules/channels/<provider>/adapter.ts
  -> /api/commanders/channel-message
  -> modules/channels/resolver.ts
  -> commanders conversation + surface binding
  -> conversation runtime / provider session
  -> transcript JSONL
  -> durable channelReplyIntent
  -> automatic channel reply forwarder / reconciler
  -> latest channelReplyDelivery
  -> modules/commanders/channel-dispatchers.ts
  -> external provider

same transcript JSONL
  -> mapStreamEventsToMessages
  -> /api/conversations/:id/messages
  -> Command Room ChatPane
  -> SessionMessageList / MarkdownContent
  -> visible user transcript
```

State owners:

- channels owns account bindings, provider runtimes, surface bindings, inbound
  normalization, and provider-specific outbound send.
- commanders owns conversation records, `channelMeta`, `lastRoute`,
  `channelReplyIntents`, `channelReplyDelivery`, and conversation runtime routes.
- agents owns session events, transcript storage, message projection, and shared
  chat rendering components.

Risk: channel tests can prove raw outbound delivery while the user-facing
Command Room transcript is still wrong. Always verify both raw transport and
visible rendered transcript, especially for short assistant replies that pass
through Markdown rendering.

## Provider Runtime Coupling

```text
adapters/<provider>
  -> provider registry metadata
  -> agents session create/restore
  -> provider context persistence
  -> Command Room/provider selectors
  -> commander conversation defaults
```

Primary files:

- `apps/herd/modules/agents/providers/registry.ts`
- `apps/herd/modules/agents/providers/provider-adapter.ts`
- `apps/herd/modules/agents/adapters/claude/`
- `apps/herd/modules/agents/adapters/codex/`
- `apps/herd/modules/agents/adapters/gemini/`
- `apps/herd/modules/agents/adapters/opencode/`
- `apps/herd/modules/agents/providers/provider-context-migration.ts`
- `apps/herd/modules/commanders/components/ProviderModelSelect.tsx`

Risk: provider registry metadata can change without changing live runtime
behavior; verify both registry/API and session runtime paths.

## Install, Launch, Release, CLI

```text
install.sh / install-ec2.sh
  -> pnpm build
  -> pnpm run db:ready
  -> launch_herd.sh
  -> server/index.ts boot readiness
  -> CLI up/doctor/status output
  -> SOP-15 public release sync
```

Primary files:

- `apps/herd/install.sh`
- `operations/deploy/ec2/install-ec2.sh`
- `operations/scripts/launch_herd.sh`
- `apps/herd/server/index.ts`
- `packages/herd-cli/src/up.ts`
- `packages/herd-cli/src/doctor.ts`
- `apps/herd/docs/reference/cli.md`
- `operations/sops/SOP-15-release-herd.md`
- `operations/deploy/ec2/Caddyfile`
- `operations/deploy/ec2/hervald.service`

Risk: a change can work on EC2 but miss the public Herd release mirror, or work
in managed launch but fail in foreground CLI startup.

Contrarian risks from source review:

- public product branding is Herd while source/service/package names still use
  Herd/Herd; SOP-15 sanitizes public output.
- public docs may use `HERD_DATA_DIR/herd.sqlite`, while implementation defaults
  to `HERD_DATA_DIR/herd.sqlite`.
- split-shell ports appear across EC2 installer, Caddy, launch scripts, tests,
  and SOPs: public `20001`, private `20009`.
