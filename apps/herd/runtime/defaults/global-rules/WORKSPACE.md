# Workspace Routing

Use this file as the operator-maintained routing table for local workspaces.
Update it when a durable top-level area appears.

Default routing rules:

- Read the nearest `AGENTS.md`, `CLAUDE.md`, or project guide before changing a
  scoped workspace.
- Search inside the likely owner directory before broad filesystem search.
- Prefer exact path reads and project-local documentation over memory.
- Record only stable workspace ownership facts here.

The installed app path is recorded in `~/.herd/app-path`.
