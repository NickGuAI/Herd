# Credential Pools

Credential pools let Herd keep separate provider credential directories for the
operator's own Codex or Claude Code accounts. They are a failover and recovery
tool for provider auth interruptions, not a way to bypass provider policy.

## What A Pool Contains

A pool belongs to one provider. Each credential has:

- a label,
- a directory under the Herd data directory,
- provider-native login material,
- status: active, available, auth required, exhausted, or cooling down.

Current public support:

| Provider | Login command shown by Herd |
|---|---|
| Codex | `CODEX_HOME=<credential-dir> codex login --device-auth` |
| Claude Code | `CLAUDE_CONFIG_DIR=<credential-dir> claude auth login` |

Herd records pool state in the provider auth store and keeps provider login
files inside the generated credential directory.

## Add A Credential

From the Herd UI:

1. Open Settings.
2. Open Credential pools.
3. Choose Add credential for Codex or Claude Code.
4. Copy the displayed provider-native login command.
5. Run that command on the Herd host.
6. Return to Settings and confirm the credential status is active or available.

When a provider-auth interruption or temporary provider error appears in a
session, the error block may also offer Switch to another ready credential or
Add credential. Those buttons use the same provider-auth API as Settings.

## Rotation And Recovery

When a credential is marked exhausted or cooling down, Herd can switch to the
next ready credential in the same provider pool. The prior credential remains
registered and can become available again after its reset time or after the
operator refreshes provider login.

Recovery behavior:

- If another ready credential exists, Herd switches the active credential.
- If the session can recover in place, Herd continues the conversation without
  rerunning completed side effects.
- If recovery cannot happen immediately, Herd queues recovery for the next
  start.
- If no ready credential exists, the UI shows the earliest known reset time or
  asks the operator to refresh provider login.

Remove a credential from Settings when the account is no longer owned by the
operator, no longer needed, or suspected to be exposed.

## macOS Daemon Policy

Mac daemon machines must use one of two Claude Code auth lanes:

```text
╔════════════════════╗      ╔════════════════════╗      ╔════════════════════╗
║ Herd host pool     ║  →   ║ WS spawn env       ║  →   ║ macOS daemon proc  ║
║ remote token ready ║      ║ CLAUDE_CODE_...    ║      ║ no file persisted  ║
╚════════════════════╝      ╚════════════════════╝      ╚════════════════════╝

Alternative: per-Mac native Claude Code login on the daemon machine.
```

- Use the env-token lane for host-managed Mac daemon sessions. Herd sends the
  ready pool credential as `CLAUDE_CODE_OAUTH_TOKEN` in the daemon spawn env for
  that process only.
- Keep per-Mac native login available as the fallback lane. In that mode the
  daemon reports native provider health and Herd does not send pool credential
  material.
- Do not materialize Claude credential files onto Macs for pool propagation.
  macOS Claude Code storage is Keychain-primary with a plaintext fallback; once
  Keychain migration succeeds, `.credentials.json` can be deleted and refreshed
  credential lineage moves into a machine-local, config-dir-hashed Keychain
  service. That strands the pool away from the Herd host and is not supported.
- Tokens from `claude setup-token` can lack the `user:profile` scope. This is
  relevant only when org-UUID enforcement is enabled; current Herd deployments
  do not enforce org UUIDs for this lane.

Related docs:

- [Provider auth](provider-auth.md)
- [Hardening](hardening.md)
- [Troubleshooting](../troubleshoot.md)
