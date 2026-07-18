import path from 'node:path'
import type { MachineCommandExecutor } from '../agents/machine-command-executor.js'

export interface EvalAdapterPreflightInput {
  machineId: string
  adapterRoot: string
  adapterModule?: string
}

export type EvalAdapterPreflightResult =
  | {
    ok: true
    machineId: string
    adapterRoot: string
    adapterModule?: string
  }
  | { ok: false; status: number; error: string }

export interface EvalAdapterPreflight {
  check(input: EvalAdapterPreflightInput): Promise<EvalAdapterPreflightResult>
}

export interface EvalAdapterDescriptor {
  adapterRoot: string
  adapterModule: string
}

const PYTHON_MODULE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u
const PREFLIGHT_TIMEOUT_MS = 10_000
const MAX_ERROR_DETAIL_LENGTH = 500

// This probe is deliberately filesystem-only. Importing an adapter (or even
// asking importlib to resolve a dotted child module) can execute caller-owned
// package initializers before a worker session exists. Runnable validation is
// therefore owned by the dispatched worker's real `python3 -m ...` command.
const PYTHON_ADAPTER_COORDINATE_PROBE = [
  'import os, sys',
  'root = sys.argv[1]',
  'module = sys.argv[2] if len(sys.argv) > 2 else ""',
  'if not os.path.isdir(root):',
  '    raise SystemExit(f"adapter root is not a directory: {root}")',
  'root = os.path.realpath(root)',
  'if module:',
  '    module_path = os.path.join(root, *module.split("."))',
  '    module_file = f"{module_path}.py"',
  '    package_init = os.path.join(module_path, "__init__.py")',
  '    package_main = os.path.join(module_path, "__main__.py")',
  '    if os.path.isfile(package_init):',
  '        if not os.path.isfile(package_main):',
  '            raise SystemExit(f"adapter package is not directly runnable: {module}")',
  '        location = package_main',
  '    elif os.path.isfile(module_file):',
  '        location = module_file',
  '    elif os.path.isdir(module_path) and os.path.isfile(package_main):',
  '        location = package_main',
  '    else:',
  '        raise SystemExit(f"adapter module was not found under the supplied root: {module}")',
  '    location = os.path.realpath(location)',
  '    try:',
  '        inside_root = os.path.commonpath([root, location]) == root',
  '    except ValueError:',
  '        inside_root = False',
  '    if not inside_root:',
  '        raise SystemExit(f"adapter module does not resolve from the supplied root: {module}")',
  'print("adapter-coordinate-ok")',
].join('\n')

function normalizeRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function parseEvalAdapterDescriptor(raw: unknown): EvalAdapterDescriptor | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const value = raw as Record<string, unknown>
  const adapterRoot = normalizeRequiredString(value.adapterRoot)
  const adapterModule = normalizeRequiredString(value.adapterModule)
  if (
    !adapterRoot
    || !path.isAbsolute(adapterRoot)
    || !adapterModule
    || !PYTHON_MODULE_PATTERN.test(adapterModule)
  ) {
    return null
  }
  return {
    adapterRoot: path.normalize(adapterRoot),
    adapterModule,
  }
}

function cleanErrorDetail(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim()
  if (!compact) {
    return 'adapter probe exited without an error message'
  }
  return compact.slice(0, MAX_ERROR_DETAIL_LENGTH)
}

export function createEvalAdapterPreflight(
  machineCommandExecutor: MachineCommandExecutor,
): EvalAdapterPreflight {
  return {
    async check(input) {
      const machineId = normalizeRequiredString(input.machineId)
      const adapterRoot = normalizeRequiredString(input.adapterRoot)
      const adapterModule = input.adapterModule === undefined
        ? undefined
        : normalizeRequiredString(input.adapterModule) ?? undefined

      if (!machineId) {
        return { ok: false, status: 400, error: 'Adapter preflight requires a machine id' }
      }
      if (!adapterRoot || !path.isAbsolute(adapterRoot)) {
        return { ok: false, status: 400, error: 'Adapter root must be an absolute path' }
      }
      if (input.adapterModule !== undefined && (!adapterModule || !PYTHON_MODULE_PATTERN.test(adapterModule))) {
        return { ok: false, status: 400, error: 'Adapter module must be a dotted Python module name' }
      }

      const normalizedRoot = path.normalize(adapterRoot)
      const execution = await machineCommandExecutor.execute({
        machineId,
        command: 'python3',
        args: [
          // Isolated, site-free startup prevents adapter-root sitecustomize,
          // user-site hooks, and ambient PYTHON* variables from running code.
          '-I',
          '-S',
          '-c',
          PYTHON_ADAPTER_COORDINATE_PROBE,
          normalizedRoot,
          ...(adapterModule ? [adapterModule] : []),
        ],
        timeoutMs: PREFLIGHT_TIMEOUT_MS,
      })

      if (!execution.ok) {
        return execution
      }
      if (execution.result.timedOut) {
        return {
          ok: false,
          status: 504,
          error: `Adapter preflight timed out on machine "${machineId}"`,
        }
      }
      if (execution.result.code !== 0) {
        const detail = cleanErrorDetail(execution.result.stderr || execution.result.stdout)
        return {
          ok: false,
          status: 422,
          error: `Adapter preflight failed on machine "${machineId}": ${detail}`,
        }
      }

      return {
        ok: true,
        machineId,
        adapterRoot: normalizedRoot,
        ...(adapterModule ? { adapterModule } : {}),
      }
    },
  }
}
