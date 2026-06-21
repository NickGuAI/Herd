export interface ParsedTailscaleStatus {
  backendState: string
  dnsName: string
  hostName: string
  label: string
  machineId: string
  magicDnsSuffix: string
  os?: string
  tailnet: string
  tailscaleIps: string[]
  primaryTailscaleIp: string
}

export type TailscaleStatusParseResult =
  | { ok: true; status: ParsedTailscaleStatus }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeTailscaleHostname(value: string): string {
  return value.trim().replace(/\.+$/u, '')
}

export function slugifyMachineId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['']/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return normalized || 'machine'
}

function titleFromSlug(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : '')
    .filter(Boolean)
    .join(' ')
}

function isIpv4(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/u.test(part)) {
      return false
    }
    const octet = Number.parseInt(part, 10)
    return octet >= 0 && octet <= 255 && String(octet) === String(Number(part))
  })
}

function isIpv6(value: string): boolean {
  return /^[0-9a-f:.]+$/iu.test(value) && value.includes(':')
}

function isIpAddress(value: string): boolean {
  return isIpv4(value) || isIpv6(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readTailnet(payload: Record<string, unknown>): {
  magicDnsSuffix: string | null
  tailnet: string | null
} {
  const currentTailnet = isRecord(payload.CurrentTailnet) ? payload.CurrentTailnet : null
  const magicDnsSuffix = (
    currentTailnet ? readString(currentTailnet, 'MagicDNSSuffix') : null
  ) ?? readString(payload, 'MagicDNSSuffix')
  const tailnet = currentTailnet ? readString(currentTailnet, 'Name') : null
  return {
    magicDnsSuffix,
    tailnet: tailnet ?? magicDnsSuffix,
  }
}

export function parseTailscaleStatusJson(statusJson: string): TailscaleStatusParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(statusJson) as unknown
  } catch {
    return { ok: false, error: 'Invalid Tailscale status JSON: paste the full output of `tailscale status --json`.' }
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'Invalid Tailscale status JSON: expected a JSON object.' }
  }

  const backendState = readString(parsed, 'BackendState')
  if (backendState !== 'Running') {
    return {
      ok: false,
      error: `Tailscale is not running (BackendState is ${backendState ? `"${backendState}"` : 'missing'}). Run \`sudo tailscale up\`, then retry.`,
    }
  }

  if (parsed.TUN !== true) {
    return { ok: false, error: 'Tailscale is not using its network interface (TUN must be true).' }
  }

  const self = isRecord(parsed.Self) ? parsed.Self : null
  if (!self) {
    return { ok: false, error: 'Tailscale status JSON is missing Self metadata.' }
  }

  if (self.Online !== true) {
    return { ok: false, error: 'This Tailscale node is offline (Self.Online must be true).' }
  }

  const dnsName = normalizeTailscaleHostname(readString(self, 'DNSName') ?? '')
  if (!dnsName) {
    return { ok: false, error: 'Tailscale status JSON is missing Self.DNSName.' }
  }

  const rawIps = Array.isArray(self.TailscaleIPs)
    ? self.TailscaleIPs
    : (Array.isArray(parsed.TailscaleIPs) ? parsed.TailscaleIPs : [])
  const tailscaleIps = rawIps
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0 && isIpAddress(value))
  if (tailscaleIps.length === 0) {
    return { ok: false, error: 'Tailscale status JSON is missing Self.TailscaleIPs.' }
  }

  const { magicDnsSuffix, tailnet } = readTailnet(parsed)
  if (!magicDnsSuffix || !tailnet) {
    return {
      ok: false,
      error: 'Tailscale status JSON is missing CurrentTailnet.MagicDNSSuffix metadata.',
    }
  }

  const dnsStem = dnsName.split('.')[0] ?? dnsName
  const hostName = readString(self, 'HostName') ?? dnsStem
  const label = hostName.trim() || titleFromSlug(dnsStem)
  const machineId = slugifyMachineId(hostName || dnsStem)
  const primaryTailscaleIp = tailscaleIps.find(isIpv4) ?? tailscaleIps[0]
  const os = readString(self, 'OS') ?? undefined

  return {
    ok: true,
    status: {
      backendState,
      dnsName,
      hostName,
      label,
      machineId,
      magicDnsSuffix,
      ...(os ? { os } : {}),
      tailnet,
      tailscaleIps,
      primaryTailscaleIp,
    },
  }
}
