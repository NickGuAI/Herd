import { describe, expect, it } from 'vitest'
import { parseTailscaleStatusJson } from '../tailscale-status.js'

function statusFixture(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    Version: '1.90.8',
    TUN: true,
    BackendState: 'Running',
    MagicDNSSuffix: 'tail2bb6ea.ts.net',
    CurrentTailnet: {
      Name: 'gehirn.ai',
      MagicDNSSuffix: 'tail2bb6ea.ts.net',
      MagicDNSEnabled: true,
    },
    Self: {
      HostName: "Nick's Mac Mini",
      DNSName: 'nicks-mac-mini.tail2bb6ea.ts.net.',
      OS: 'macOS',
      Online: true,
      TailscaleIPs: ['100.101.102.103', 'fd7a:115c:a1e0::abcd:1234'],
    },
    Peer: {
      'nodekey:offline': {
        HostName: 'Offline Peer',
        DNSName: 'offline-peer.tail2bb6ea.ts.net.',
        Online: false,
        TailscaleIPs: ['100.64.0.2'],
      },
    },
    ...overrides,
  })
}

describe('parseTailscaleStatusJson', () => {
  it('normalizes full tailscale status JSON into machine registration data', () => {
    const parsed = parseTailscaleStatusJson(statusFixture())

    expect(parsed).toEqual({
      ok: true,
      status: {
        backendState: 'Running',
        dnsName: 'nicks-mac-mini.tail2bb6ea.ts.net',
        hostName: "Nick's Mac Mini",
        label: "Nick's Mac Mini",
        machineId: 'nicks-mac-mini',
        magicDnsSuffix: 'tail2bb6ea.ts.net',
        os: 'macOS',
        tailnet: 'gehirn.ai',
        tailscaleIps: ['100.101.102.103', 'fd7a:115c:a1e0::abcd:1234'],
        primaryTailscaleIp: '100.101.102.103',
      },
    })
  })

  it('falls back to IPv6 when no IPv4 address is present', () => {
    const parsed = parseTailscaleStatusJson(statusFixture({
      Self: {
        HostName: 'IPv6 Host',
        DNSName: 'ipv6-host.tail2bb6ea.ts.net.',
        OS: 'linux',
        Online: true,
        TailscaleIPs: ['fd7a:115c:a1e0::abcd:1234'],
      },
    }))

    expect(parsed.ok && parsed.status.primaryTailscaleIp).toBe('fd7a:115c:a1e0::abcd:1234')
  })

  it('returns actionable errors for invalid or disconnected status JSON', () => {
    expect(parseTailscaleStatusJson('{').ok).toBe(false)
    expect(parseTailscaleStatusJson(statusFixture({ BackendState: 'NeedsLogin' }))).toEqual({
      ok: false,
      error: 'Tailscale is not running (BackendState is "NeedsLogin"). Run `sudo tailscale up`, then retry.',
    })
    expect(parseTailscaleStatusJson(statusFixture({ TUN: false }))).toEqual({
      ok: false,
      error: 'Tailscale is not using its network interface (TUN must be true).',
    })
    expect(parseTailscaleStatusJson(statusFixture({
      Self: {
        HostName: 'Offline',
        DNSName: 'offline.tail2bb6ea.ts.net.',
        Online: false,
        TailscaleIPs: ['100.64.0.1'],
      },
    }))).toEqual({
      ok: false,
      error: 'This Tailscale node is offline (Self.Online must be true).',
    })
  })
})
