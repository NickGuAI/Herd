# Herd v0.0.4-beta

Public beta release synced from monorepo `main` on 2026-07-02.

## Highlights

### Credential pool and provider recovery
- In-place credential pool rotation with deferred recovery persistence (#1813 / #1814).
- Recheck blocked credential recovery on send and bound fallback scans.
- Claude credential switch recovery and usage-limit signal gating (#1808 / #1809).
- Lean recovery path with drain-race fixes for commander replacement.

### Command Room and conversation UX
- Conversation cache shape crash fix (#1816).
- Conversation UX invariants: idle composer behavior, modal forms instead of prompt flows, reduced healthy-list polling (#1807).
- Live conversation list polling improvements.
- Active conversation boot-state sanitization and idle commanders until runtime restore.

### Onboarding, settings, and channels
- Dismissible bootstrap API key rotation prompt with settings guidance.
- Provider defaults and channel form contract fixes.
- Commander mobile shell and channel onboarding fixes.
- Hardened automatic channel reply delivery with concurrent delivery preservation.
- Channel inbound-drop accounting across Slack, Discord, Telegram, Google Chat, and WhatsApp.

### Cleanup and polish
- Removed dead Herd UI/code paths from issue #1807 (sentinels consolidation, mock assets, legacy command-room components).
- Replaced fake skill DAG with package inspector.
- User-facing Herd phrasing replaced with Herd across console UI, CLI, and ops output.
- Added UI-to-backend logic flow architecture diagram and engineering architecture-diagram skill in monorepo docs.

## Install

```bash
curl -fsSL https://herd.gehirn.ai/install.sh | bash
```

Pinned default checkout: `v0.0.4-beta`

## Upgrade notes

- Installer default ref moves from `v0.0.3-beta` to `v0.0.4-beta`.
- Release source continues to ship without tracked tests, mocks, or internal benchmark fixtures.
- SQLite runtime store remains at `~/.herd/herd.sqlite`.
