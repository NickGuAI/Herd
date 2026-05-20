import {
  Bot,
  FilePlus,
  FileText,
  Pencil,
  Plug,
  Search,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react'

type ToolColorClass =
  | 'text-[color:var(--hv-accent-info)]'
  | 'text-[color:var(--hv-accent-warning)]'
  | 'text-[color:var(--hv-accent-success)]'

const TOOL_META: Record<string, { icon: LucideIcon; colorClass: ToolColorClass }> = {
  Read: { icon: FileText, colorClass: 'text-[color:var(--hv-accent-info)]' },
  Glob: { icon: Search, colorClass: 'text-[color:var(--hv-accent-info)]' },
  Grep: { icon: Search, colorClass: 'text-[color:var(--hv-accent-info)]' },
  Edit: { icon: Pencil, colorClass: 'text-[color:var(--hv-accent-warning)]' },
  MultiEdit: { icon: Pencil, colorClass: 'text-[color:var(--hv-accent-warning)]' },
  Write: { icon: FilePlus, colorClass: 'text-[color:var(--hv-accent-success)]' },
  NotebookEdit: { icon: Pencil, colorClass: 'text-[color:var(--hv-accent-warning)]' },
  Bash: { icon: TerminalSquare, colorClass: 'text-[color:var(--hv-accent-warning)]' },
  WebFetch: { icon: Search, colorClass: 'text-[color:var(--hv-accent-info)]' },
  WebSearch: { icon: Search, colorClass: 'text-[color:var(--hv-accent-info)]' },
  LSP: { icon: FileText, colorClass: 'text-[color:var(--hv-accent-info)]' },
  TodoWrite: { icon: FilePlus, colorClass: 'text-[color:var(--hv-accent-success)]' },
  Agent: { icon: Bot, colorClass: 'text-[color:var(--hv-accent-info)]' },
}

export function getToolMeta(name: string) {
  if (TOOL_META[name]) {
    return TOOL_META[name]
  }
  if (name.startsWith('mcp__')) {
    return { icon: Plug, colorClass: 'text-[color:var(--hv-accent-info)]' as ToolColorClass }
  }
  return { icon: TerminalSquare, colorClass: 'text-[color:var(--hv-accent-warning)]' as ToolColorClass }
}

export function formatToolDisplayName(name: string): { displayName: string; service?: string } {
  if (!name.startsWith('mcp__')) {
    return { displayName: name }
  }

  const stripped = name.slice(5)
  const lastSep = stripped.lastIndexOf('__')
  if (lastSep === -1) {
    return { displayName: name }
  }

  const server = stripped
    .slice(0, lastSep)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()

  const toolPart = stripped
    .slice(lastSep + 2)
    .replace(/[-_]/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())

  return { displayName: toolPart, service: server }
}

export function isAgentAccentColor(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length > 80) {
    return false
  }
  return /^#[0-9a-f]{3,8}$/i.test(trimmed)
    || /^rgba?\(/i.test(trimmed)
    || /^[a-z][a-z0-9-]*$/i.test(trimmed)
}
