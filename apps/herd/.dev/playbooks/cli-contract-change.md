# CLI Contract Change

1. Start with command router:
   - `packages/herd-cli/src/index.ts`

2. Inspect command file:
   - startup/readiness: `packages/herd-cli/src/up.ts`,
     `packages/herd-cli/src/doctor.ts`
   - sessions: `packages/herd-cli/src/session.ts`
   - workers: `packages/herd-cli/src/workers.ts`
   - shared contracts: `packages/herd-cli/src/session-contract.ts`
   - app shim: `apps/herd/herd-cli.mjs`

3. Check server DTO source before changing output:
   - `apps/herd/modules/agents/types.ts`
   - `apps/herd/modules/agents/routes/session-query-routes.ts`
   - `apps/herd/modules/agents/session/state.ts`

4. Preserve API-only behavior:
   - `dispatch`, `send`, `kill`, `register`, `heartbeat`, `events`, and
     `unregister` should call backend APIs, not local runtime files.

5. Verify:

```bash
pnpm --filter @gehirn/herd-cli test -- up.test.ts doctor.test.ts workers.test.ts session.test.ts
pnpm --filter @gehirn/herd-cli test
```

6. Update operator docs when visible output changes:
   - `apps/herd/docs/reference/cli.md`
