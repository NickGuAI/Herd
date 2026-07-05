import type { OrgIdentity } from '../../org-identity/types'
import type { Operator } from '../../operators/types'

const cardClass =
  'card-sumi flex min-h-32 min-w-0 items-center justify-center px-5 py-6 text-center'

const cardButtonClass =
  `${cardClass} appearance-none transition-colors hover:bg-[var(--hv-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--hv-border-firm)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--hv-bg)]`

const textClass =
  'max-w-full break-words text-center font-display text-2xl leading-tight text-[color:var(--hv-fg)] [overflow-wrap:anywhere] sm:text-3xl'

export function OrgTopRow({
  orgIdentity,
  operator,
  onHire,
}: {
  orgIdentity: OrgIdentity | null
  operator: Operator
  onHire: () => void
}) {
  const orgName = orgIdentity?.name ?? 'Organization'

  return (
    <section
      data-testid="org-top-row"
      className="grid grid-cols-1 gap-6 md:grid-cols-3"
    >
      <article data-testid="org-row-card-org" className={cardClass}>
        <h1 className={textClass}>{orgName}</h1>
      </article>

      <article data-testid="org-row-card-user" className={cardClass}>
        <p className={textClass}>{operator.displayName}</p>
      </article>

      <div data-testid="org-row-card-hire" className="min-w-0">
        <button
          type="button"
          data-testid="commander-hire-button"
          onClick={onHire}
          className={`${cardButtonClass} h-full w-full`}
        >
          <span className={textClass}>Recruit</span>
        </button>
      </div>
    </section>
  )
}
