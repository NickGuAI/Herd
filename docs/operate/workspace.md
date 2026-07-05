# Workspace

Workspace gives a commander and conversation a concrete file target. It powers
file browsing, previews, raw file access, git state, and context insertion.

## Operator Checklist

- Confirm the selected commander and conversation.
- Confirm the workspace target path.
- Use file preview before attaching file context.
- Use git state to distinguish pending changes from committed history.
- Keep the service data directory durable across redeploys; workspace target
  selections persist under that data root.
- If a file opens from chat but not from the workspace panel, verify the target
  id and path are the same.

## Deploy Notes

The workspace target store must survive checkout replacement, systemd unit
refreshes, and service restarts. On EC2, install with `--data-dir <path>` when
the durable data root differs from the checkout path; the systemd unit should
keep pointing at that same data root after each redeploy.

Related docs:

- [Command Room](../concepts/command-room.md)
- [Workers](../concepts/workers.md)
