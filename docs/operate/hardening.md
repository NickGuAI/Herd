# Hardening

Herd agents can execute shell commands through provider CLIs on local or
registered machines. Harden the host before letting agents operate on real
repositories, cloud accounts, email, calendars, or production data.

## Network Shape

Use this shape for an internet-reachable Linux web host:

```text
browser / iOS
      |
      v
TLS reverse proxy
      |
      v
Herd on loopback
      |
      v
provider CLIs and worker machines
```

Keep the raw Herd port private. Expose only the TLS endpoint from the reverse
proxy or load balancer.

## Caddy Example

This is an optional shape for self-managed deployments: Caddy terminates TLS,
serves static web assets, and proxies API, WebSocket, telemetry, and installer
traffic to the local Herd service. The enterprise EC2 release lane instead
terminates TLS at the ALB and forwards directly to Herd on port `20001`.

```caddyfile
herd.example.com {
	encode zstd gzip

	respond /healthz 200

	@api path /api/* /v1/* /install.sh
	handle @api {
		reverse_proxy 127.0.0.1:20001
	}

	handle {
		root * /opt/herd/app/dist
		try_files {path} /index.html
		file_server
	}
}
```

If your proxy and Herd process run on the same host, bind Herd to loopback and
let Caddy be the only public listener. If the proxy is remote, put the Herd
listener behind a private network, firewall rule, or security group that only
the proxy can reach.

## Bind Address

- Preferred: Herd listens on `127.0.0.1` and Caddy listens on `443`.
- Acceptable for private networks: Herd listens on a private interface that is
  reachable only from the reverse proxy or trusted tailnet.
- Avoid: exposing `:20001` directly to the internet.

After changing the bind address, verify from the host and from outside:

```bash
curl -fsS http://127.0.0.1:20001/api/health
curl -fsS https://herd.example.com/api/health
```

## Key Rotation

Rotate keys when onboarding completes, when a machine changes owners, when a
provider account changes, and after any suspected exposure.

| Secret | Rotation action |
|---|---|
| Bootstrap key | Create a permanent key in Settings, then revoke or let the 24-hour bootstrap key expire. |
| Permanent API keys | Create a replacement in Settings, update clients, then revoke the old key. |
| Mobile pairing keys | Re-pair the iOS client and revoke old mobile credentials. |
| Provider credentials | Re-run the provider-native login for the affected credential directory or provider host. |
| Machine env credentials | Replace the machine env entries, re-encrypt local managed env files, and restart active workers. |

Do not paste keys into issue comments, chat transcripts, screenshots, or PR
descriptions.

## Machine Credential Expiry

Machine env files and provider credential directories should be treated as
expiring operational material even when the file format does not enforce an
expiry timestamp.

- Prefer provider tokens with their own expiry and revocation controls.
- Remove machine credentials when a worker host is decommissioned.
- Re-run machine readiness after rotating credentials.
- If an encrypted machine env file cannot be decrypted, replace it rather than
  bypassing encryption with a plaintext file.

Related docs:

- [Machines and workers](machines.md)
- [Provider auth](provider-auth.md)
- [Credential pools](credential-pools.md)
- [Enterprise EC2](enterprise-ec2.md)
- [Uninstall](uninstall.md)
