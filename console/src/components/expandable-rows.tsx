// A list of rows where clicking one opens its details in place, directly under the row.
import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface Props<T> {
  items: T[]
  getId: (item: T) => string
  openId?: string
  onToggle: (id: string | undefined) => void
  /** Grid template for header and rows, including the leading chevron column. Literal Tailwind classes. */
  grid: string
  header: ReactNode
  row: (item: T, open: boolean) => ReactNode
  detail: (item: T) => ReactNode
  /** Optional accent for a row, e.g. events that raised an alert. */
  rowClassName?: (item: T) => string | undefined
  footer?: ReactNode
}

export function ExpandableRows<T>({ items, getId, openId, onToggle, grid, header, row, detail, rowClassName, footer }: Props<T>) {
  return (
    <div>
      <div className={cn("hidden gap-4 px-4 pb-2 text-xs font-semibold tracking-wide text-section uppercase lg:grid", grid)}>{header}</div>
      <div className="overflow-hidden rounded-lg border bg-card">
        {items.map((item, j) => {
          const id = getId(item)
          const open = id === openId
          return (
            <div key={id} className={cn(j > 0 && "border-t")}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => onToggle(open ? undefined : id)}
                className={cn(
                  "grid w-full items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/50",
                  grid,
                  open && "bg-section/10 hover:bg-section/15",
                  rowClassName?.(item),
                )}
              >
                <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90 text-section")} />
                {row(item, open)}
              </button>
              {open && <div className="border-t border-section/20">{detail(item)}</div>}
            </div>
          )
        })}
        {footer}
      </div>
    </div>
  )
}
