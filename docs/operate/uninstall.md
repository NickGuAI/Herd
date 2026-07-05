# Uninstall

Uninstall Herd by stopping the process, revoking access, and deleting the local
checkout and data directory after you have exported anything you need.

## Before Removing Files

1. Export or copy any commander memory, transcripts, or workspace artifacts you
   need to keep.
2. Revoke permanent API keys from Settings.
3. Remove mobile pairing credentials.
4. Remove or rotate provider credentials and machine env credentials.
5. Stop active workers so they cannot keep using stale credentials.

## Stop Autostart And The Service

If Herd is running in the foreground, stop it with `Ctrl-C`.

If you installed a service, stop and disable it with your host's service
manager before deleting files.

macOS launchd user service:

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.gehirn.hervald.plist" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/io.gehirn.hervald.plist"
rm -rf "$HOME/Library/Logs/hervald"
```

Linux user-systemd service from the local installer:

```bash
systemctl --user disable --now io.gehirn.hervald.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/io.gehirn.hervald.service"
systemctl --user daemon-reload 2>/dev/null || true
```

Linux system service from the EC2 installer:

```bash
sudo systemctl disable --now herd.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/herd.service
sudo systemctl daemon-reload
```

Confirm the health endpoint no longer responds:

```bash
curl -fsS http://127.0.0.1:20001/api/health
```

The command should fail once the service is stopped.

## Remove Local State And Toolchain

Delete the application checkout and the Herd data directory only after the
credential rotation above is complete.

Remove the checkout, data directory, and hermetic toolchain shown in the
installer receipt or in your service environment. If you used custom paths,
remove those custom paths instead.

Common local installer paths:

```bash
rm -rf "$HOME/Herd"
rm -rf "$HOME/.herd"
rm -f "$HOME/.local/bin/herd"
rm -f "$HOME/.herd-env"
```

Common EC2 paths, if you accepted the examples in this guide:

```bash
sudo rm -rf /opt/herd
sudo rm -rf /var/lib/herd
```

If the installer receipt lists a separate toolchain directory such as
`$HERD_DATA_DIR/toolchain`, remove that directory too.

## Verify

- The Herd process is stopped.
- The reverse proxy route no longer serves the old instance.
- API keys and mobile credentials are revoked.
- Provider accounts no longer trust deleted credential directories.
- Worker machines no longer contain env files created only for this Herd
  installation.

Related docs:

- [Hardening](hardening.md)
- [Troubleshooting](../troubleshoot.md)
