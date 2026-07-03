# CLI Reference

Herd is primarily operated through the browser UI. Use the root workspace
commands for local development and deployment checks:

| Task | Command |
|---|---|
| Install dependencies | `pnpm install` |
| Build | `pnpm run build` |
| Test | `pnpm test` |
| Start | `pnpm start` |
| Check SQLite runtime-session store | `pnpm run db:ready -- --source-root "$HERD_DATA_DIR" --db "$HERD_DATA_DIR/herd.sqlite"` |
| Migrate legacy runtime sessions | `pnpm run migrate:sqlite -- --source-root "$HERD_DATA_DIR" --db "$HERD_DATA_DIR/herd.sqlite" --backup` |
| Start local app through the CLI | The installed CLI `up` command checks SQLite runtime-session readiness before foreground startup |
| Inspect local operator readiness | The installed CLI `doctor` command includes SQLite runtime-session data dir, DB path, schema/readiness status, and remediation output |
| Inspect runtime sessions | The installed CLI session list/info commands render backend runtime `state` when available |
| Inspect workers | The installed CLI worker list/status commands render backend runtime `state` when available |

For operator workflows such as machines, workers, provider auth, and
transcripts, use the visible Herd UI surfaces documented here:

- [Machines and workers](../operate/machines.md)
- [Provider auth](../operate/provider-auth.md)
- [Command Room](../concepts/command-room.md)
