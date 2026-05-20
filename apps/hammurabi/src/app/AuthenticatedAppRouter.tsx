import { Suspense, lazy, useMemo, type ComponentType, type LazyExoticComponent } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { FOUNDER_SETUP_PATH } from '@modules/onboarding/contracts'
import { useFounderSetupStatus } from '@modules/onboarding/hooks/useFounderOnboarding'
import { bindFrontendGraphToStaticBindings } from '@/module-graph-bindings'
import { useModuleGraph } from '@/hooks/use-module-graph'
import { ModuleGraphProvider } from '@/module-graph-context'
import type { FrontendModule, FrontendModuleBinding } from '@/types'
import type { HammurabiModuleGraphResponse } from '@/types/module-graph-api'
import { Shell } from '@/surfaces/desktop/Shell'

interface ModuleRoute {
  path: string
  Component: LazyExoticComponent<ComponentType>
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-3 w-3 animate-breathe rounded-full bg-sumi-mist" />
    </div>
  )
}

function StartupError({
  error,
  onRetry,
}: {
  error: Error
  onRetry: () => void
}) {
  return (
    <div className="flex h-full w-full items-center justify-center px-4 py-8">
      <div className="card-sumi flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl font-medium text-sumi-black">Hervald</h1>
        <p className="text-sm text-sumi-diluted">{error.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white transition-colors hover:bg-sumi-black/90"
        >
          Retry
        </button>
      </div>
    </div>
  )
}

export function AuthenticatedAppRouter({
  componentBindings,
  moduleGraph,
}: {
  componentBindings: FrontendModuleBinding[]
  moduleGraph?: HammurabiModuleGraphResponse
}) {
  const moduleGraphQuery = useModuleGraph({ enabled: !moduleGraph })
  const graph = moduleGraph ?? moduleGraphQuery.data ?? null
  const boundGraph = useMemo(
    () => (graph ? bindFrontendGraphToStaticBindings(componentBindings, graph) : null),
    [componentBindings, graph],
  )
  const onboardingModule = boundGraph?.routes.find((module) => module.path === FOUNDER_SETUP_PATH)
  const defaultRoutePath = boundGraph?.routes.find((module) => module.routeId === 'org.ui')?.path ?? '/org'
  const shellModules = useMemo(
    () => boundGraph?.routes.filter((module) => module.path !== FOUNDER_SETUP_PATH) ?? [],
    [boundGraph],
  )
  const shellModuleRoutes = useMemo<ModuleRoute[]>(
    () => shellModules.map((module) => ({
      path: module.path,
      Component: lazy(module.component),
    })),
    [shellModules],
  )
  const OnboardingPage = useMemo(
    () => (onboardingModule ? lazy(onboardingModule.component) : null),
    [onboardingModule],
  )
  const founderSetup = useFounderSetupStatus()

  if (founderSetup.error) {
    return (
      <StartupError
        error={founderSetup.error as Error}
        onRetry={() => {
          void founderSetup.refetch()
        }}
      />
    )
  }

  if (moduleGraphQuery.error && !moduleGraph) {
    return (
      <StartupError
        error={moduleGraphQuery.error as Error}
        onRetry={() => {
          void moduleGraphQuery.refetch()
        }}
      />
    )
  }

  if (!graph || !boundGraph || founderSetup.isLoading || !founderSetup.data) {
    return <Loading />
  }

  if (!OnboardingPage) {
    throw new Error(`Onboarding route "${FOUNDER_SETUP_PATH}" is not registered`)
  }

  if (!founderSetup.data.setupComplete) {
    const setupRoutePath = founderSetup.data.nextRoute
    return (
      <ModuleGraphProvider graph={graph}>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path={`${setupRoutePath}/*`} element={<OnboardingPage />} />
            <Route path="*" element={<Navigate to={setupRoutePath} replace />} />
          </Routes>
        </Suspense>
      </ModuleGraphProvider>
    )
  }

  const completedSetupRoutePath = founderSetup.data.nextRoute || defaultRoutePath

  return (
    <ModuleGraphProvider graph={graph}>
      <Shell modules={boundGraph.nav}>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Navigate to={completedSetupRoutePath} replace />} />
            <Route path={FOUNDER_SETUP_PATH} element={<Navigate to={completedSetupRoutePath} replace />} />
            {boundGraph.redirects.map((redirect) => (
              <Route
                key={redirect.id}
                path={redirect.from}
                element={<Navigate to={redirect.to} replace />}
              />
            ))}
            {shellModuleRoutes.map((route) => (
              <Route
                key={route.path}
                path={`${route.path}/*`}
                element={<route.Component />}
              />
            ))}
          </Routes>
        </Suspense>
      </Shell>
    </ModuleGraphProvider>
  )
}
