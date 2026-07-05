# CLI Reference

Herd is primarily operated through the browser UI. Use the root workspace
commands for local development and deployment checks:

| Task | Command |
|---|---|
| Install dependencies | `pnpm install` |
| Build | `pnpm run build` |
| Test | `pnpm test` |
| Start | `pnpm start` |
| Check JSON data stores | `pnpm run store:ready -- --source-root "$HERD_DATA_DIR"` |
| Check SQLite runtime-session store | `pnpm run db:ready -- --source-root "$HERD_DATA_DIR" --db "$HERD_DATA_DIR/herd.sqlite"` |
| Migrate legacy runtime sessions | `pnpm run migrate:sqlite -- --source-root "$HERD_DATA_DIR" --db "$HERD_DATA_DIR/herd.sqlite" --backup` |
| Start local app through the CLI | The installed CLI `up` command checks SQLite runtime-session readiness before foreground startup |
| Upgrade an installed checkout | `herd update --tag <release-tag>` fetches the tag, rebuilds, runs JSON and SQLite readiness, and restarts the service |
| Inspect local operator readiness | The installed CLI `doctor` command includes SQLite runtime-session data dir, DB path, schema/readiness status, and remediation output |
| Inspect runtime sessions | The installed CLI session list/info commands render backend runtime `state` when available |
| Inspect workers | The installed CLI worker list/status commands render backend runtime `state` when available |
| Connect a daemon machine | `<installed-cli> connect <url> --token <enrollment-token>` |
| Inspect daemon pairing | machine daemon-status |
| Rotate an existing daemon pairing | machine daemon-pair |

The CLI connect command is the fresh-machine path. It posts the `hmre_` enrollment token
to Herd, receives a machine id plus `hmrd_` daemon credentials, and chains into
the daemon runner. Enrollment tokens expire after 24 hours by default; pairing
tokens are per-machine, hashed at rest, revocable, and expire after 180 days by
default. Expired connect tokens fail with re-mint guidance, and `daemon-status`
prints the pairing expiry for re-pair decisions.

For operator workflows such as machines, workers, provider auth, and
transcripts, use the visible Herd UI surfaces documented here:

- [Machines and workers](../operate/machines.md)
- [Provider auth](../operate/provider-auth.md)
- [Command Room](../concepts/command-room.md)
