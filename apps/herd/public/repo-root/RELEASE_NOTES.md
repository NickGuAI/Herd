# Herd v0.0.8-beta

Herd `v0.0.8-beta` moves the current public release line to GNU AGPLv3 while
shipping the provider, conversation, and deployment improvements accumulated
since `v0.0.7-beta`.

## License

- Herd `v0.0.8-beta` is open source under GNU AGPLv3 (`AGPL-3.0-only`).
- No license purchase is required for commercial use that complies with the
  AGPL.
- A separate paid commercial agreement is available for proprietary or other
  non-AGPL use; see
  [COMMERCIAL-LICENSE.md](https://github.com/NickGuAI/Herd/blob/v0.0.8-beta/COMMERCIAL-LICENSE.md).
- Earlier tagged releases retain the license terms included with those
  releases.

## Highlights

- One Codex model catalogue now drives conversations and credentials: GPT-5.6
  SOL, GPT-5.5, GPT-5.4, GPT-5.4 Mini, GPT-5.3 Codex, and GPT-5.3 Codex Spark.
  Every model exposes `low`, `medium`, `high`, and `max` effort; `ultra` is
  available only for `gpt-5.6-sol`.
- Adapter-backed benchmark bootstrap and run commands now require an explicit
  absolute `--adapter-root`; run also requires a validated `--adapter-module`.
  The canonical orchestration runner is `herd-orchestrated`.
- Stronger credential-pool selection, Claude authentication recovery, quota
  refresh, and conversation resume continuity.
- More reliable queued and in-flight sends across runtime transitions, with
  approval-policy context preserved through worker handoffs.
- Clearer grouping for sub-agent transcript activity.
- A simplified direct-ALB enterprise EC2 topology: the Node server owns UI,
  API, and WebSockets on port `20001`, while port `20009` is reserved for the
  loopback development API.

## Upgrade and compatibility

```bash
herd update --tag v0.0.8-beta
```

Fresh installs continue to use:

```bash
curl -fsSL https://herd.gehirn.ai/install.sh | bash
```

- Local Claude credential selection is now managed globally in Settings.
  Legacy per-conversation local Claude pins are ignored or rejected; Codex and
  remote-token Claude credentials remain selectable per conversation.
- Persisted Codex `minimal` and `xhigh` effort values normalize to `low` and
  `max`. `ultra` is accepted only for `gpt-5.6-sol`.
- Eval callers must now pass an absolute `--adapter-root` to benchmark
  commander bootstrap and run commands, pass `--adapter-module` to run, and
  use `herd-orchestrated` instead of the retired runner identity.
- Enterprise ALB targets must use port `20001` with `/api/health`; port `20009`
  is development-only. The EC2 upgrade retires the legacy Herd Caddy site
  safely, preserving other Caddy sites and restoring its backup on failure.

## Verification

- Application build and lint.
- Installer, release-runtime, SQLite-readiness, launch, and SOP-15 contract
  tests.
- CLI tests, documentation guardrails, and website tests, lint, and build.
- Exact GNU AGPLv3 license checksum and canonical-versus-served installer byte
  parity.

## Source Traceability

- The public artifact is generated from the merged canonical source through
  SOP-15.
- The GitHub release records the exact canonical-source and public-artifact
  commit IDs used for publication.
