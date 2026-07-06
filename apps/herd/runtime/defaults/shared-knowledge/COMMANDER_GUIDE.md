# Commander Guide

This guide captures shared Herd operating procedures. Keep command examples
generic and update them when the product contract changes.

Common commands:

```bash
herd doctor
herd commanders list
herd quests list --commander <commander-id>
herd quests claim <quest-id> --commander <commander-id>
herd quests done <quest-id> --commander <commander-id> --note "<summary>"
```

Operating rules:

- Read active quests before starting work.
- Use one active quest at a time unless the operator explicitly asks for
  parallel work.
- Record durable facts with `herd memory save` only when they will matter
  later.
- Keep transient scratch state in working memory or task notes, not in durable
  shared files.
- Clean up completed worker sessions after worker-backed work is verified.
