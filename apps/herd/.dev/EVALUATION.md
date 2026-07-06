# Evaluation

## 2026-06-21 Initial Generation

Project root: `/home/builder/App/apps/herd`

Output: `/home/builder/App/apps/herd/.dev`

## Files Inspected

- `apps/herd/docs/module-index.xml`
- `apps/herd/src/module-manifest.ts`
- `apps/herd/docs/architecture/agents.md`
- `apps/herd/docs/architecture/command-room.md`
- `apps/herd/docs/architecture/frontend-surfaces.md`
- `apps/herd/docs/features/commanders.md`
- `apps/herd/docs/features/providers.md`
- `apps/herd/docs/concepts/command-room.md`
- `apps/herd/docs/reference/cli.md`
- `apps/herd/docs/troubleshoot.md`
- `apps/herd/package.json`
- `apps/herd/install.sh`
- `apps/herd/server/index.ts`
- `apps/herd/server/db/schema.ts`
- `apps/herd/server/db/readiness.ts`
- `apps/herd/tools/db-ready.ts`
- `apps/herd/tools/migrate-sqlite.ts`
- `apps/herd/modules/agents/session/state.ts`
- `apps/herd/modules/agents/session/sqlite-runtime-store.ts`
- `apps/herd/modules/agents/routes/session-query-routes.ts`
- `apps/herd/modules/agents/routes/session-control-routes.ts`
- `apps/herd/modules/agents/routes-core.ts`
- `apps/herd/modules/agents/websocket.ts`
- `apps/herd/modules/agents/transcript-store.ts`
- `apps/herd/modules/command-room/components/CommandRoom.tsx`
- `apps/herd/modules/command-room/components/mobile/MobileCommandRoom.tsx`
- `apps/herd/modules/conversation/hooks/use-conversations.ts`
- `apps/herd/modules/commanders/routes/conversation-read-model.ts`
- `apps/herd/modules/commanders/routes/conversation-runtime.ts`
- `apps/herd/modules/commanders/routes/conversation-runtime-state.ts`
- `apps/herd/modules/commanders/routes/conversation-websocket.ts`
- `apps/herd/src/surfaces/`
- `apps/herd/src/hooks/use-is-mobile.ts`
- `apps/herd/src/lib/api-base.ts`
- `apps/herd/capacitor.config.ts`
- `packages/herd-cli/src/up.ts`
- `packages/herd-cli/src/doctor.ts`
- `packages/herd-cli/src/session.ts`
- `packages/herd-cli/src/workers.ts`
- `operations/deploy/ec2/install-ec2.sh`
- `operations/deploy/ec2/Caddyfile`
- `operations/deploy/ec2/hervald.service`
- `operations/scripts/launch_herd.sh`
- `operations/sops/SOP-15-release-herd.md`

## Commands Run

```bash
pnpm --filter @gehirn/herd-cli test -- up.test.ts doctor.test.ts workers.test.ts session.test.ts
pnpm --filter @gehirn/herd-cli build
pnpm --filter herd run db:ready -- --source-root ~/.herd --db ~/.herd/herd.sqlite
pnpm --filter herd run docs:check
make -C agent-skills test
make fmt && make test && make lint
find apps/herd/.dev -maxdepth 3 -type f | sort
rg -n "runtime session|Command Room|install|release|CLI|mobile|desktop|agent_runtime_sessions" apps/herd/.dev
```

Result: targeted CLI tests and build passed; SQLite readiness passed; docs guardrail passed; agent skill validation passed; root formatter/test/lint gate passed; fixture files and keyword coverage were inspected.

## Review Roles

- topology/module reviewer: subagent `019eec3d-fc74-7ee3-b7eb-262a69992a25`
  inspected runtime sessions, Command Room, conversation read models, and
  websocket ownership.
- verification/test reviewer: subagent `019eec3e-0de9-74e0-afb2-07eafd4468ce`
  mapped tests and commands for runtime, Command Room, providers, CLI, install,
  release, and mobile/desktop UI.
- release/install/ops reviewer: subagent `019eec3e-1f26-7d23-a8af-5f102f2c71a8`
  mapped installer, EC2 deploy, split-shell launch, public release, CLI, and DB
  readiness coupling.
- contrarian reviewer: performed in the main thread because the subagent
  concurrency limit blocked a fourth explorer.

## Unsupported Assumptions Rejected

- Rejected: Command Room owns durable runtime state. Evidence:
  `apps/herd/docs/module-index.xml` marks Command Room as composed UI and
  browser preference owner only.
- Rejected: Provider registry owns live process state. Evidence:
  `apps/herd/docs/features/providers.md` separates provider registry
  metadata from agents runtime sessions/process handles.
- Rejected: SQLite readiness belongs only to server boot. Evidence:
  `apps/herd/install.sh`, `operations/deploy/ec2/install-ec2.sh`, and
  `operations/scripts/launch_herd.sh` also call `db:ready`.
- Rejected: CLI worker/session status can be treated as a separate lifecycle
  model. Evidence: backend DTOs expose `state`, `allowedActions`, and
  `disabledReasons` from `modules/agents/session/state.ts` and query routes.
- Rejected: browser automation is an existing fixture requirement. Evidence:
  `apps/herd` has `vitest.config.ts` and no `playwright.config.*` under
  the app root.

## Gaps For Human Review

- No browser screenshot pass was run for Command Room/mobile UI because this
  fixture does not change UI rendering.

## 2026-07-06 Runtime Restore Refresh

Project root: `/home/builder/App/apps/herd`

Output: `/home/builder/App/apps/herd/.dev`

Current source head: `f4bb405e3 (HEAD -> dev, origin/dev) Fix Herd runtime restore latency`

## Files Inspected

- `apps/herd/CLAUDE.md`
- `.claude/rules/herd.md`
- `apps/herd/docs/llms.txt`
- `apps/herd/docs/architecture/agents.md`
- `apps/herd/docs/architecture/module-runtime.md`
- `apps/herd/docs/architecture/routes-and-apis.md`
- `apps/herd/docs/troubleshoot.md`
- `apps/herd/.dev/README.md`
- `apps/herd/.dev/ROUTING.md`
- `apps/herd/.dev/COUPLINGS.md`
- `apps/herd/.dev/VERIFY.md`
- `apps/herd/.dev/SOP_INDEX.md`
- `apps/herd/.dev/maps/runtime-sessions.md`
- `apps/herd/.dev/maps/channels.md`
- `apps/herd/.dev/playbooks/sqlite-runtime-session-change.md`
- `apps/herd/.dev/playbooks/channel-impacting-change.md`
- `apps/herd/.dev/learnings/*.md`
- `apps/herd/modules/agents/routes-core.ts`
- `apps/herd/modules/agents/persistence-helpers.ts`
- `apps/herd/modules/agents/session/persistence.ts`
- `apps/herd/modules/agents/session/sqlite-runtime-store.ts`
- `apps/herd/modules/agents/session/__tests__/sqlite-runtime-store.test.ts`
- `apps/herd/server/db/schema.ts`
- `operations/scripts/launch_herd.sh`
- `operations/deploy/ec2/check-herd-split-shell.sh`
- `operations/logs/server/herd/latest/launch.log`

## Commands Run

```bash
git fetch origin dev
git log -1 --oneline --decorate
find apps/herd/.dev -maxdepth 3 -type f | sort
find apps/herd/.dev -maxdepth 2 -type f | sort
rg -n "restorePersistedSessionsReady|readSqlitePersistedSessionsState|runtime_state_json|compactRuntimeStateEvents|LEGACY_RUNTIME_EVENTS_STRIP|MAX_RUNTIME_STATE_EMBEDDED_EVENTS|sqlite-runtime-store.test" apps/herd/modules/agents apps/herd/server apps/herd/.dev apps/herd/docs .claude/rules/herd.md
rg -n "Failed to restore persisted session|Unexpected end of JSON input|bubblewrap|ERROR|unhandled|uncaught|crash|restart" operations/logs/server/herd/latest/launch.log
pnpm --filter herd run docs:check
rg -n <deleted 2026-06-23 channel learning filename patterns> apps/herd/.dev .claude/rules/herd.md apps/herd/docs
bash operations/deploy/ec2/check-herd-split-shell.sh --domain herd.gehirn.ai --service-port 20009 --shell-port 20001
curl -fsS -w '\nstatus=%{http_code} total=%{time_total}\n' https://herd.gehirn.ai/api/health
git status --short --branch
```

Result: docs guardrail passed. The superseded channel learning filenames have
no remaining references. Split-shell topology passed. Public health returned
`200` on version `f4bb405e3`.

## Review Roles

- topology/module reviewer: performed in the main thread against agents routes,
  persistence helpers, SQLite runtime store, and runtime-session map.
- verification/test reviewer: performed in the main thread against
  `VERIFY.md`, the runtime-session Vitest bundle, `docs:check`, and production
  health/split-shell probes.
- release/install/ops reviewer: performed in the main thread against
  `operations/scripts/launch_herd.sh`,
  `operations/deploy/ec2/check-herd-split-shell.sh`, and the active launch log.
- contrarian reviewer: performed in the main thread. The refresh removed
  duplicate dated channel incident learnings only after confirming the durable
  guidance is already consolidated in `playbooks/channel-impacting-change.md`,
  `maps/channels.md`, and `VERIFY.md`.

## Unsupported Assumptions Rejected

- Rejected: `/api/health` proves agents route responsiveness. Evidence:
  `apps/herd/modules/agents/routes-core.ts` gates agents routes on
  `restorePersistedSessionsReady`, while health does not use that router.
- Rejected: large `runtime_state_json` rows are only a storage-size issue.
  Evidence: `apps/herd/modules/agents/persistence-helpers.ts` calls
  `readSqlitePersistedSessionsState` before provider restore, and
  `apps/herd/modules/agents/session/sqlite-runtime-store.ts` parses each
  projected row.
- Rejected: old per-incident channel learning files must remain because they
  are useful. Evidence: their reusable rules are now in
  `apps/herd/.dev/playbooks/channel-impacting-change.md`,
  `apps/herd/.dev/maps/channels.md`, and
  `apps/herd/.dev/VERIFY.md`; `rg` found no remaining references to the
  deleted filenames.

## Gaps For Human Review

- No browser screenshot pass was run because this refresh only changed `.dev`
  documentation and one path-scoped rule file.
- The new techdebt note records remaining runtime restore follow-ups; it does
  not implement the one-off SQLite compaction or restore telemetry work.
