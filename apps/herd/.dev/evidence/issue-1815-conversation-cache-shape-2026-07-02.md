# Issue 1815 Conversation Cache Shape Evidence

Date: 2026-07-02

Issue: https://github.com/NickGuAI/Herd/issues/1815

## Root Cause

`useConversationMessages` seeds React Query `initialData` by scanning cached
queries with the broad `['commanders', 'conversations']` prefix.

```
['commanders', 'conversations'] prefix
+-- ['commanders', 'conversations', commanderId]
|   +-- ConversationRecord[]       (safe to map)
+-- ['commanders', 'conversations', 'active', commanderId]
    +-- ConversationRecord | null  (not safe to map)
```

The active-conversation cache stores one `ConversationRecord | null`, but the
list-cache scan treated every prefix match as `ConversationRecord[]`. When the
active cache appeared in that scan, `.map()` executed on an object and crashed
the Command Room render path with `TypeError: i.map is not a function`.

## Fix

- Changed the broad prefix scan in
  `modules/conversation/hooks/use-conversations.ts` to read cache values as
  `unknown` and skip non-array values before mapping.
- Added a regression test in
  `modules/conversation/__tests__/use-conversations-start-stop.test.tsx` that
  seeds both an active-conversation object and a commander conversation list,
  proving the object is skipped and the list still seeds message initial data.
- Added `/app-verification` under `agent-skills/gehirn-devpkg` to select and
  document app-owned verification SOPs.

## Verification

All commands below were run from the repository root unless noted.

| Check | Result |
|---|---|
| `node agent-skills/gehirn-devpkg/app-verification/scripts/select-verification.mjs --project apps/herd --changed apps/herd/modules/conversation/hooks/use-conversations.ts --changed apps/herd/modules/conversation/__tests__/use-conversations-start-stop.test.tsx` | Passed; selected `Cheap Local Checks` and `Command Room`. |
| `python3 /Users/yugu/.codex/skills/.system/skill-creator/scripts/quick_validate.py agent-skills/gehirn-devpkg/app-verification` | Passed; skill is valid. |
| `pnpm --filter herd exec vitest run modules/conversation/__tests__/use-conversations-start-stop.test.tsx` | Passed; 6 tests. |
| `pnpm --filter herd exec vitest run ...Command Room bundle from .dev/VERIFY.md...` | Passed; 11 files, 101 tests. |
| `make -C agent-skills test` | Passed; 63 skill files validated. |
| `pnpm --filter herd run docs:check` | Passed; Herd docs guardrail passed. |
| `pnpm --filter @gehirn/herd-cli test -- up.test.ts doctor.test.ts workers.test.ts session.test.ts` | Passed; 28 files, 277 tests. |
| `pnpm --filter herd run db:ready -- --source-root ~/.herd --db ~/.herd/herd.sqlite` | Passed; SQLite runtime-session database ready. |
| `pnpm --filter herd run lint` | Passed. |
| `pnpm --filter herd run build` | Passed; Vite reported existing large chunk/dynamic import warnings. |
| `pnpm --filter herd test` | Passed; 348 files passed, 2304 tests passed, 13 skipped. |

## Local Server Check

Default local ports were already occupied by an existing Cursor-owned Herd
process, so verification used an isolated data directory and alternate port:

```bash
PORT=20115 \
NODE_ENV=production \
HERD_DATA_DIR=/tmp/herd-pr1815 \
HERD_BACKGROUND_RUNTIMES=0 \
pnpm --filter herd run start
```

Runtime evidence:

- `GET http://127.0.0.1:20115/api/health` returned `status: "ok"`,
  `backgroundRuntimes: "disabled"`, `database.ready: true`, and 19 modules.
- `GET http://127.0.0.1:20115/org` returned `200 OK` and served the built Herd
  app shell.
- Playwright opened `http://127.0.0.1:20115/org`; page title was `Herd`.
- Playwright snapshot showed the authenticated sign-in screen:
  `Herd`, `Sign in with API key`, API-key textbox, disabled `Sign in` button,
  and `Authenticated access only`.
- Playwright console reported 0 errors and 0 warnings.

Notes:

- The test suites still emit existing React `act(...)` warnings in unrelated
  component tests.
- `pnpm` still reports existing workspace warnings from `apps/openclaw-ultima`
  package-level `pnpm` fields.
