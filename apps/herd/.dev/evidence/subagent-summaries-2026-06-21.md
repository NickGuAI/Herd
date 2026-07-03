# Subagent Summaries - 2026-06-21

## Topology Reviewer

Agent: `019eec3d-fc74-7ee3-b7eb-262a69992a25`

Findings folded into `.dev`:

- Command Room is a composed UI surface, not a runtime/data owner. Source:
  `apps/herd/src/module-manifest.ts`,
  `apps/herd/docs/architecture/command-room.md`,
  `apps/herd/modules/command-room/components/CommandRoom.tsx`.
- Runtime sessions are owned by agents and SQLite. Source:
  `apps/herd/modules/agents/routes-core.ts`,
  `apps/herd/modules/agents/session/sqlite-runtime-store.ts`.
- Conversation runtime couples commanders to agents through the sessions
  interface. Source:
  `apps/herd/modules/commanders/routes/conversation-runtime.ts`.
- Backend conversation read model owns sendability/action state. Source:
  `apps/herd/modules/commanders/routes/conversation-read-model.ts`,
  `apps/herd/modules/command-room/__tests__/backend-owned-contract-guardrails.test.ts`.
- Raw session websockets and conversation websocket aliases are distinct.
  Source: `apps/herd/modules/agents/websocket.ts`,
  `apps/herd/modules/commanders/routes/conversation-websocket.ts`.

## Verification Reviewer

Agent: `019eec3e-0de9-74e0-afb2-07eafd4468ce`

Findings folded into `.dev`:

- Baseline gates: `pnpm test`, `pnpm run build`, `pnpm run lint`,
  `pnpm run docs:check` from `apps/herd/package.json`.
- No `playwright.config.*` was found under `apps/herd`; use Vitest and
  manual desktop/mobile checks.
- Added targeted tests for runtime sessions, provider registry, Command Room,
  install/release app routes, mobile/desktop surfaces, and Capacitor commands.

## Release / Install / Ops Reviewer

Agent: `019eec3e-1f26-7d23-a8af-5f102f2c71a8`

Findings folded into `.dev`:

- `apps/herd/install.sh` is the canonical Herd installer and runs SQLite
  readiness before launch.
- `operations/deploy/ec2/install-ec2.sh`, `operations/deploy/ec2/Caddyfile`,
  and `operations/deploy/ec2/hervald.service` define EC2 split-shell behavior.
- `operations/sops/SOP-15-release-herd.md` and
  `operations/sops/scripts/sop-15-sync-herd.sh` define the public release sync.
- `apps/herd/herd-cli.mjs` delegates to `@gehirn/herd-cli`.
- Contrarian risks: Herd/Herd/Herd naming split, public `HERD_DATA_DIR`
  docs vs implementation `HERD_DATA_DIR`, hardcoded split ports, dual
  worker dispatch contracts, and DB readiness blocking install/launch/doctor/boot.
