// Small building blocks shared by every page.
import { AlertCircle, CheckCircle2, CircleDashed, XCircle } from "lucide-react"
import type { ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Priority, Severity } from "@/lib/api"
import { splitTerms } from "@/lib/glossary"
import { cn } from "@/lib/utils"

const SEV: Record<string, string> = {
  critical: "bg-sev-critical/15 text-sev-critical border-sev-critical/30",
  high: "bg-sev-high/15 text-sev-high border-sev-high/30",
  medium: "bg-sev-medium/15 text-sev-medium border-sev-medium/30",
  low: "bg-sev-low/15 text-sev-low border-sev-low/30",
}

export function SeverityBadge({ severity }: { severity: Severity | string }) {
  return (
    <Badge variant="outline" className={cn("uppercase tracking-wide font-semibold", SEV[severity] ?? "")}>
      {severity}
    </Badge>
  )
}

// Literal class names so Tailwind generates them.
const DOT: Record<string, string> = {
  critical: "bg-sev-critical",
  high: "bg-sev-high",
  medium: "bg-sev-medium",
  low: "bg-sev-low",
}

export function SeverityDot({ severity }: { severity: Severity | string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", DOT[severity] ?? "bg-muted-foreground")} />
}

const PRI: Record<Priority, string> = {
  P1: SEV.critical,
  P2: SEV.high,
  P3: SEV.medium,
  P4: SEV.low,
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge variant="outline" className={cn("font-semibold", PRI[priority])}>
      {priority}
    </Badge>
  )
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  return outcome === "success" ? (
    <Badge variant="outline" className="border-ok/30 bg-ok/10 text-ok">success</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">denied</Badge>
  )
}

export function Mitre({ ids }: { ids: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <a
          key={id}
          href={`https://attack.mitre.org/techniques/${id.replace(".", "/")}/`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-info hover:underline"
        >
          {id}
        </a>
      ))}
    </span>
  )
}

export function Status({ ok, label }: { ok: boolean | undefined; label: string }) {
  const Icon = ok === undefined ? CircleDashed : ok ? CheckCircle2 : XCircle
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", ok ? "text-ok" : ok === false ? "text-sev-critical" : "text-muted-foreground")}>
      <Icon className="size-4" />
      {label}
    </span>
  )
}

export function Stat({ label, value, hint, tone, icon, section }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "bad" | "good"; icon?: ReactNode; section?: string }) {
  return (
    <Card data-section={section} className="relative gap-2 overflow-hidden">
      <span className="absolute inset-x-0 top-0 h-1 bg-section" />
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          {icon && <span className="flex size-7 items-center justify-center rounded-md bg-section/15 text-section [&_svg]:size-4">{icon}</span>}
          {label}
        </CardDescription>
        <CardTitle className={cn("text-3xl tabular-nums", tone === "bad" && "text-sev-critical", tone === "good" && "text-ok")}>{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  )
}

/** A card that belongs to one section: a coloured top edge and a coloured title icon. */
export function SectionCard({ section, className, children }: { section: string; className?: string; children: ReactNode }) {
  return (
    <Card data-section={section} className={cn("relative overflow-hidden", className)}>
      <span className="absolute inset-x-0 top-0 h-1 bg-section" />
      {children}
    </Card>
  )
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? "–"}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Code({ children, className }: { children: string; className?: string }) {
  return (
    <pre className={cn("max-h-[28rem] overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed", className)}>
      {children}
    </pre>
  )
}

export function Mono({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn("font-mono text-xs", className)}>{children}</span>
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Could not load data</AlertTitle>
      <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
    </Alert>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}

export function PageHeader({ title, description, actions, icon }: { title: string; description: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-section/20 bg-gradient-to-br from-section/15 via-section/5 to-card p-5 md:p-6">
      <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-section/10 blur-2xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-[min(100%,24rem)] flex-1 items-start gap-4">
          {icon && <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-section text-white shadow-sm [&_svg]:size-5">{icon}</span>}
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </div>
  )
}

/** Very small Markdown renderer for runbooks: paragraphs, lists, code. */
export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```(?:\w+)?\n([\s\S]*?)```/g)
  return (
    <div className="space-y-2 text-sm">
      {blocks.map((block, i) =>
        i % 2 === 1 ? (
          <Code key={i}>{block.replace(/^\s{3}/gm, "").trim()}</Code>
        ) : (
          block
            .split("\n")
            .filter((l) => l.trim())
            .map((line, j) => {
              const m = line.match(/^\s*(?:-|\d+\.)\s+(.*)$/)
              const content = inline(m ? m[1] : line)
              return m ? (
                <div key={`${i}-${j}`} className="flex gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>{content}</span>
                </div>
              ) : (
                <p key={`${i}-${j}`}>{content}</p>
              )
            })
        ),
      )}
    </div>
  )
}

function inline(s: string) {
  return s.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith("`") ? (
      <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
        {part.slice(1, -1)}
      </code>
    ) : (
      <RichText key={i} text={part} />
    ),
  )
}

/** Text with glossary terms highlighted: GCP names in blue code style, security concepts in amber. Hover or focus shows the meaning. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {splitTerms(text).map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className={cn(
                  "cursor-help rounded box-decoration-clone px-1 py-0.5",
                  part.entry.kind === "gcp" ? "bg-info/10 font-mono text-[0.92em] text-info" : "bg-sev-medium/15 font-medium text-sev-high",
                )}
              >
                {part.term}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{part.entry.meaning}</TooltipContent>
          </Tooltip>
        ),
      )}
    </>
  )
}

/** A rule description, with a one-line key to the highlighting. */
export function Description({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm leading-relaxed"><RichText text={text.trim()} /></p>
      <p className="text-xs text-muted-foreground">Hover a highlighted term to see what it means.</p>
    </div>
  )
}
