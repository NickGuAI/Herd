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
