import { Bug, ExternalLink } from "lucide-react"
import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ErrorBox, KV, Loading, Mono, PageHeader, PriorityBadge, SectionCard, SeverityBadge, Stat, Status } from "@/components/falcon"
import { useApi, type Priority, type Triage, type TriageAction, type TriageFinding } from "@/lib/api"
import { navigate } from "@/lib/router"

const SLA: Record<Priority, string> = { P1: "7 days", P2: "30 days", P3: "90 days", P4: "180 days, report only" }

function describe(a?: TriageAction) {
  if (!a) return "–"
  switch (a.kind) {
    case "create": return `Open issue in ${a.repo}`
    case "update": return `Re-prioritize ${a.issue} (was ${a.from})`
    case "nudge": return `Nudge owners on ${a.issue}`
    case "reopen": return `Reopen ${a.issue}`
    case "close": return `Close ${a.issue}: ${a.reason}`
    case "report-only": return "Report only"
    case "ok": return `Tracked in ${a.issue}`
  }
}

export function Vulnerabilities({ openId }: { openId?: string }) {
  const triage = useApi<Triage>("triage")
  const [repo, setRepo] = useState("all")
  const findings = useMemo(() => (triage.data?.findings ?? []).filter((f) => repo === "all" || f.repo === repo), [triage.data, repo])
  const actionFor = (key: string) => triage.data?.actions.find((a) => a.key === key && a.kind !== "close")
  const open = triage.data?.findings.find((f) => f.key === openId)
  const closes = triage.data?.actions.filter((a) => a.kind === "close") ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Bug />}
        title="Vulnerabilities"
        description="Dependabot and code-scanning alerts, scored by real-world risk (CVSS, EPSS exploit probability, CISA KEV, exposure), routed to owners through CODEOWNERS and given a fix deadline."
        actions={
          triage.data && (
            <Select value={repo} onValueChange={setRepo}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All repositories</SelectItem>
                {triage.data.repos.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          )
        }
      />
      {triage.error && <ErrorBox error={triage.error} />}
      {triage.loading && !triage.data && <Loading rows={6} />}
      {triage.data && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{triage.data.mode}</Badge>
            SLAs evaluated as of {new Date(triage.data.now).toLocaleDateString(undefined, { dateStyle: "medium" })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {(["P1", "P2", "P3", "P4"] as Priority[]).map((p) => {
              const list = findings.filter((f) => f.priority === p)
              const late = list.filter((f) => f.overdueDays > 0).length
              return <Stat key={p} section="vulnerabilities" label={`${p} · fix within ${SLA[p].split(",")[0]}`} value={list.length} tone={late ? "bad" : undefined} hint={late ? `${late} overdue` : "none overdue"} />
            })}
            <Stat
              section="vulnerabilities"
              label="SLA gate (CI)"
              value={triage.data.gate.passed ? "Pass" : "Fail"}
              tone={triage.data.gate.passed ? "good" : "bad"}
              hint={triage.data.gate.passed ? "no overdue P1/P2" : "overdue P1/P2 findings block the build"}
            />
          </div>

          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader className="bg-section/10">
                <TableRow>
                  <TableHead>Priority</TableHead>
                  <TableHead className="w-40">Score</TableHead>
                  <TableHead>Finding</TableHead>
                  <TableHead className="hidden lg:table-cell">Owners</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="hidden xl:table-cell">Planned action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.map((f) => (
                  <TableRow key={f.key} className="cursor-pointer" onClick={() => navigate("vulnerabilities", f.key)}>
                    <TableCell><PriorityBadge priority={f.priority} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={f.score} className="h-1.5 w-20" />
                        <span className="tabular-nums">{f.score}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-96">
                      <div className="truncate font-medium">{f.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        <Mono>{f.package}</Mono> · {f.ecosystem} · {f.repo}{f.cve ? ` · ${f.cve}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-56 truncate text-sm lg:table-cell">{f.owners.join(", ")}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {f.overdueDays > 0 ? <span className="text-sev-critical">{f.overdueDays}d overdue</span> : <span className="text-muted-foreground">{f.due}</span>}
                    </TableCell>
                    <TableCell className="hidden min-w-48 text-sm whitespace-normal xl:table-cell">{describe(actionFor(f.key))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {closes.length > 0 && (
            <SectionCard section="vulnerabilities">
              <CardHeader>
                <CardTitle>Issues to close</CardTitle>
                <CardDescription>Falcon-managed issues whose alert is already fixed</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {closes.map((a) => <div key={a.key}><Mono>{a.issue}</Mono> · {a.reason}</div>)}
              </CardContent>
            </SectionCard>
          )}
        </>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && navigate("vulnerabilities")}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">{open && <FindingDetail f={open} action={actionFor(open.key)} />}</SheetContent>
      </Sheet>
    </div>
  )
}

function FindingDetail({ f, action }: { f: TriageFinding; action?: TriageAction }) {
  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2"><PriorityBadge priority={f.priority} /><SeverityBadge severity={f.severity} /></div>
        <SheetTitle className="text-xl">{f.title}</SheetTitle>
        <SheetDescription>{f.cve ?? f.package} in {f.repo}</SheetDescription>
      </SheetHeader>
      <div className="min-w-0 space-y-6 px-4 pb-8">
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="font-semibold">Why {f.priority}</h3>
            <span className="text-2xl font-semibold tabular-nums">{f.score}<span className="text-sm text-muted-foreground"> / 100</span></span>
          </div>
          <Progress value={f.score} />
          <ul className="space-y-1.5 text-sm">
            {f.reasons.map((r) => <li key={r} className="rounded-md border px-3 py-2">{r}</li>)}
          </ul>
        </section>
        <KV
          rows={[
            ["Package", <Mono>{f.package}</Mono>],
            ["Ecosystem", f.ecosystem],
            ["Source", `${f.source} #${f.number}`],
            ["Path", <Mono>{f.path}</Mono>],
            ["Owners", f.owners.join(", ")],
            ["SLA", SLA[f.priority]],
            ["Due", f.overdueDays > 0 ? <span className="text-sev-critical">{f.due} ({f.overdueDays} days overdue)</span> : f.due],
            ["Planned action", describe(action)],
          ]}
        />
        <Status ok={f.overdueDays === 0} label={f.overdueDays === 0 ? "Within SLA" : "Past its SLA: owners get a weekly nudge"} />
        <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-info hover:underline">
          Open the alert on GitHub <ExternalLink className="size-3.5" />
        </a>
      </div>
    </>
  )
}
