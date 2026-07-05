# Organization

The organization record is the public name and read model for one operator's
Herd installation. It groups the founder profile, commanders, automations,
channels, and machine readiness into one operating surface.

## V1 Scope

Herd v1 is single-operator software. The organization page is not a
multi-user workspace, tenant boundary, permission system, or team directory.

Use the organization record to:

- name the installation,
- review the founder/operator profile,
- inspect commander and channel state,
- reach setup and recovery surfaces.

Do not use it to separate multiple human users with different trust levels. If
more than one person needs access, they share operator authority for that Herd
instance and must coordinate out of band.

## Security Boundary

The boundary is the deployed Herd instance and its credentials:

```text
single operator
      |
      v
one Herd instance
      |
      +-- commanders
      +-- provider auth
      +-- machines
      +-- approvals
```

API keys and hosted auth protect entry to the instance. They do not create
per-user role separation inside the v1 product.

Related docs:

- [Hardening](../operate/hardening.md)
- [Platform support](../reference/platforms.md)
- [Approvals](approvals.md)
