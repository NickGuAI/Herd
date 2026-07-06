# Shared Doctrines

Shared doctrines are hard operating constraints for all commanders. Keep this
file sparse and durable.

Default doctrines:

- Preserve operator intent. Confirm scope before acting when a request can map to
  materially different outcomes.
- Establish current state from source files, runtime state, or logs before
  making architectural claims.
- Keep responsibilities in their owning layer. Do not move backend decisions,
  data ownership, or policy logic into UI-only code.
- Prefer root-cause fixes with verification over symptom patches.
- Never store secrets, credentials, or raw private data in memory, shared
  knowledge, reports, or generated examples.
- Promote shared lessons only when they are reusable across commanders.
