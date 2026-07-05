# Platform Support

This matrix describes the public v1 support contract.

| Platform | Status | Notes |
|---|---|---|
| Linux web host | Official | Supported self-host target for the Herd web control plane. Run behind TLS and a reverse proxy. |
| iOS | Official | Supported native/mobile client target for connecting to a Herd instance. |
| macOS | Unsupported | Development may work, but v1 self-host support, release testing, and hardening guidance target Linux. |
| Windows | Unsupported | Native Windows and WSL are not official v1 deployment targets. |

Worker machines still need ordinary machine readiness: provider CLIs, SSH or
daemon connectivity, and credentials owned by the operator. Platform support
does not make an untrusted worker safe.

Related docs:

- [Quickstart](../getting-started/quickstart.md)
- [Hardening](../operate/hardening.md)
- [Machines and workers](../operate/machines.md)
