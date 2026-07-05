# Enterprise EC2

Use this page when running Herd as an enterprise-managed EC2 service behind
Caddy. The release lane keeps the browser shell public and the application API
private on loopback.

## Architecture

```
╔══════════════╗      ╔══════════════════════╗      ╔════════════════════╗
║ Browser/iOS  ║ ───▶ ║ Caddy shell :20001   ║ ───▶ ║ Herd API 127.0.0.1 ║
║ or ALB       ║      ║ /healthz + static UI ║      ║ PORT=20009         ║
╚══════════════╝      ╚══════════════════════╝      ╚════════════════════╝
                              │
                              └─ /api/* /v1/* /install.sh only
```

Keep `20009` private. Public traffic should reach Caddy on `20001`, then Caddy
proxies only API, telemetry, WebSocket, and installer routes to the Herd API.

## Provision

1. Launch an Ubuntu 22+ or Amazon Linux 2023 EC2 host with durable storage.
2. Choose an app checkout path such as `/opt/herd`.
3. Choose a data directory such as `/var/lib/herd`; keep it stable across
   upgrades.
4. Point DNS at the host for direct Caddy TLS, or place an ALB in front of
   Caddy and forward to port `20001`.
5. Run the EC2 installer from the deploy assets:

```bash
sudo bash operations/deploy/ec2/install-ec2.sh \
  --domain herd.example.com \
  --app-user <linux-user> \
  --install-dir /opt/herd \
  --data-dir /var/lib/herd
```

The installer resolves the public release layout at `apps/herd` and
`packages/herd-cli`, installs `herd.service`, sets `HERD_HOST=127.0.0.1`, sets
`PORT=20009`, builds the app, installs Caddy, and verifies the split shell.

### Upgrading From Herd

Hosts installed before the rename may still have `hervald.service` bound to the
private API port. The EC2 installer disables that legacy unit, removes
`/etc/systemd/system/hervald.service`, reloads systemd, starts `herd.service`,
and refuses to pass local health if the old unit is still active.

## TLS And Load Balancers

- Direct TLS: point DNS to the EC2 host and let Caddy obtain and renew the
  certificate.
- ALB front end: terminate TLS at the ALB and send traffic to Caddy on
  `20001`. Use `/healthz` for the target health check.
- Do not register `20009` as an ALB target and do not open it to the internet.

## Verify

Run these checks on the host after install:

```bash
curl -fsS http://127.0.0.1:20009/api/health
curl -fsS http://127.0.0.1:20001/healthz
curl -fsS http://127.0.0.1:20001/api/health
sudo systemctl status herd --no-pager
sudo systemctl status caddy --no-pager
```

Reboot once and repeat:

```bash
sudo reboot
# reconnect after the host returns
curl -fsS http://127.0.0.1:20001/api/health
sudo systemctl is-active herd caddy
```

## Upgrade

Use the Herd update command:

```bash
herd update --tag v0.0.5-beta
```

Omit `--tag` only when the host can reach the release remote and should choose
the latest `v*` release tag automatically. The command fetches the target tag,
rebuilds the checkout, runs JSON-store and SQLite readiness checks against the
configured data directory, and restarts `herd.service`.

After the update, confirm the service is healthy and that Caddy still proxies
`/api/health` to the loopback API.

Rollback uses the previous git revision printed by `herd update`:

```bash
sudo systemctl stop herd
cd /opt/herd
sudo -u <linux-user> git reset --hard <previous-commit>
sudo -u <linux-user> pnpm install --frozen-lockfile
sudo -u <linux-user> pnpm --filter herd run build
sudo systemctl start herd
curl -fsS http://127.0.0.1:20001/api/health
```

## Backup

Back up the data directory before upgrades:

```bash
sudo systemctl stop herd
sudo tar -C /var/lib -czf "/var/backups/herd-data-$(date -u +%Y%m%dT%H%M%SZ).tgz" herd
sudo systemctl start herd
curl -fsS http://127.0.0.1:20001/api/health
```

The data directory stores commander memory, API keys, machine records, runtime
session state, local database files, and operational logs. Keep backups outside
the EC2 root volume for production instances.
