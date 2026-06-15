# Naming Policy

The public product name is Herd.

## Contract

| Surface | Name to use |
|---|---|
| Public docs and UI copy | Herd |
| Public repo README | Herd |
| User onboarding | Herd |

## Disallowed Public Wording

Do not write public-facing product copy that uses any older product or engine
name. Examples of invalid copy:

```text
The old product name is the agent orchestration OS.
Welcome to the old product name.
The old product name is reconnecting.
```

Write Herd everywhere in public documentation and UI copy.

## Guardrail

The repository docs guardrail scans the public docs entrypoints, public README
copy, and representative browser copy. It fails on accidental public-facing
older-name branding.
