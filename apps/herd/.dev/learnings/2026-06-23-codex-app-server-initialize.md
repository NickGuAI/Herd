# 2026-06-23 Codex App-Server Initialize Drift

Incident: a persisted Codex conversation had `providerContext.threadId`, but
resume failed before Herd could send `thread/resume`. Command Room then had
no live conversation websocket and showed the reconnect fallback.

Cause: the installed `codex` CLI app-server protocol had gained a required
`InitializeCapabilities.requestAttestation` field. Herd still initialized
Codex with only `experimentalApi`, so the app-server process exited during
bootstrap and never reached native thread resume.

Review rule: provider resume bugs are not only conversation-store bugs. Check
the adapter handshake against the installed provider CLI protocol before
debugging UI state.

Codex protocol check:

```bash
tmpdir=$(mktemp -d /tmp/codex-protocol-XXXXXX)
codex app-server generate-ts --out "$tmpdir"
sed -n '1,120p' "$tmpdir/InitializeCapabilities.ts"
sed -n '1,120p' "$tmpdir/v2/ThreadResumeParams.ts"
```

Required evidence before declaring a Codex resume fix done:

- `initialize` request includes every currently required capability field.
- `thread/resume` receives the persisted `providerContext.threadId`.
- the conversation DTO reports `runtimeState: "active"` and
  `websocketReady: true`.
- Command Room renders the immediate heartbeat after resume.
