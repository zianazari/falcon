import { Activity, AlertTriangle, Bug, FileCode2, Inbox, LayoutDashboard, ShieldCheck, Workflow } from "lucide-react"
import { useMemo } from "react"
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { Badge } from "@/components/ui/badge"
import { CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ErrorBox, Loading, Mono, PageHeader, PriorityBadge, SectionCard, SeverityBadge, SeverityDot, Stat, Status } from "@/components/falcon"
import { useApi, type DeadLetter, type FalconAlert, type FalconEvent, type PipelineStatus, type Rule, type Triage } from "@/lib/api"
import { ago, SEVERITY_ORDER, shortResource } from "@/lib/format"
import { href } from "@/lib/router"

const chartConfig = {
  allowed: { label: "Events", color: "oklch(0.6 0.14 240)" },
  denied: { label: "Denied calls", color: "var(--muted-foreground)" },
  alerts: { label: "Alerts", color: "oklch(0.62 0.21 20)" },
} satisfies ChartConfig

const STEPS = [1e3, 5e3, 15e3, 30e3, 60e3, 5 * 60e3, 15 * 60e3, 3600e3, 6 * 3600e3, 86400e3]

function timeline(events: FalconEvent[], alerts: FalconAlert[]) {
  const times = events.map((e) => new Date(e.ts).getTime())
  if (!times.length) return []
  const min = Math.min(...times)
  const max = Math.max(...times, ...alerts.map((a) => new Date(a.event_ts).getTime()))
  const step = STEPS.find((s) => (max - min) / s <= 40) ?? 86400e3
  const start = Math.floor(min / step) * step
  const buckets = Array.from({ length: Math.floor((max - start) / step) + 1 }, (_, i) => ({
    t: start + i * step,
    allowed: 0,
    denied: 0,
    alerts: 0,
  }))
  const at = (ms: number) => buckets[Math.min(buckets.length - 1, Math.max(0, Math.floor((ms - start) / step)))]
  for (const e of events) at(new Date(e.ts).getTime())[e.outcome === "failure" ? "denied" : "allowed"]++
  for (const a of alerts) at(new Date(a.event_ts).getTime()).alerts++
  const spanDays = (max - min) / 86400e3
  return buckets.map((b) => ({
    ...b,
    label: new Date(b.t).toLocaleString(
      undefined,
      spanDays > 1 ? { month: "short", day: "numeric", hour: "2-digit" } : step < 60e3 ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit" },
    ),
  }))
}

export function Overview() {
  const events = useApi<FalconEvent[]>("events")
  const alerts = useApi<FalconAlert[]>("alerts")
  const dead = useApi<DeadLetter[]>("deadletters")
  const rules = useApi<Rule[]>("rules")
  const triage = useApi<Triage>("triage")
  const pipeline = useApi<PipelineStatus>("pipeline")

  const series = useMemo(() => timeline(events.data ?? [], alerts.data ?? []), [events.data, alerts.data])
  const bySeverity = SEVERITY_ORDER.map((s) => ({ s, n: (alerts.data ?? []).filter((a) => a.severity === s).length }))
  const overdue = (triage.data?.findings ?? []).filter((f) => f.overdueDays > 0)
  const fixtures = (rules.data ?? []).reduce((n, r) => n + r.fixtures.should_fire.length + r.fixtures.should_not_fire.length, 0)
  const denied = (events.data ?? []).filter((e) => e.outcome === "failure").length
  const processed = Number(pipeline.data?.stats?.events ?? pipeline.data?.stats?.processed ?? events.data?.length ?? 0)

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<LayoutDashboard />}
        title="Overview"
        description="Everything Falcon watches in one place: cloud audit events streaming through the detection pipeline, the alerts they raised, and the vulnerability backlog the triager manages."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Stat section="events" icon={<Activity />} label="Events processed" value={processed.toLocaleString()} hint={`${denied} denied calls among the last ${events.data?.length ?? 0}`} />
        <Stat
          section="alerts"
          icon={<AlertTriangle />}
          label="Alerts raised"
          value={alerts.data?.length ?? "–"}
          tone={(alerts.data?.length ?? 0) > 0 ? "bad" : "good"}
          hint={bySeverity.filter((b) => b.n).map((b) => `${b.n} ${b.s}`).join(" · ") || "nothing suspicious"}
        />
        <Stat section="pipeline" icon={<Inbox />} label="Dead-lettered" value={dead.data?.length ?? "–"} hint="malformed messages kept, not lost" />
        <Stat section="detections" icon={<FileCode2 />} label="Detection rules" value={rules.data?.filter((r) => r.enabled).length ?? "–"} hint={`${fixtures} test fixtures`} />
        <Stat
          section="vulnerabilities"
          icon={<Bug />}
          label="Overdue vulnerabilities"
          value={triage.data ? overdue.length : "–"}
          tone={overdue.length ? "bad" : "good"}
          hint={triage.data ? `of ${triage.data.findings.length} open findings` : undefined}
        />
        <Stat
          section="vulnerabilities"
          icon={<ShieldCheck />}
          label="SLA gate"
          value={triage.data ? (triage.data.gate.passed ? "Pass" : "Fail") : "–"}
          tone={triage.data ? (triage.data.gate.passed ? "good" : "bad") : undefined}
          hint="CI check for overdue P1/P2"
        />
      </div>

      <SectionCard section="pipeline">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Workflow className="size-4 text-section" />Pipeline</CardTitle>
          <CardDescription>Where an audit event travels before it becomes an alert</CardDescription>
          <CardAction>
            <a href={href("pipeline")} className="text-sm text-info hover:underline">Details</a>
          </CardAction>
        </CardHeader>
        <CardContent>
          {pipeline.error ? <ErrorBox error={pipeline.error} /> : <Flow status={pipeline.data} />}
        </CardContent>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard section="events" className="xl:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="size-4 text-section" />Activity</CardTitle>
            <CardDescription>Audit events and the alerts they triggered, last {events.data?.length ?? 0} events</CardDescription>
          </CardHeader>
          <CardContent>
            {events.loading && !events.data ? (
              <Loading rows={5} />
            ) : series.length ? (
              <ChartContainer config={chartConfig} className="h-72 w-full">
                <ComposedChart data={series} margin={{ left: -16, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="allowed" stackId="e" fill="var(--color-allowed)" isAnimationActive={false} />
                  <Bar dataKey="denied" stackId="e" fill="var(--color-denied)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Line
                    dataKey="alerts"
                    stroke="var(--color-alerts)"
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                    type="linear"
                    isAnimationActive={false}
                    dot={(p: { cx?: number; cy?: number; value?: number; index?: number }) =>
                      p.value ? <circle key={p.index} cx={p.cx} cy={p.cy} r={5} fill="var(--color-alerts)" stroke="var(--background)" strokeWidth={2} /> : <g key={p.index} />
                    }
                  />
                </ComposedChart>
              </ChartContainer>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">No events yet.</p>
            )}
          </CardContent>
        </SectionCard>

        <SectionCard section="alerts" className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-section" />Latest alerts</CardTitle>
            <CardDescription>Rule matches, newest first</CardDescription>
            <CardAction>
              <a href={href("alerts")} className="text-sm text-info hover:underline">All alerts</a>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-1">
            {alerts.error && <ErrorBox error={alerts.error} />}
            {alerts.data?.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No alerts. Run an attack to see one.</p>}
            {alerts.data?.slice(0, 6).map((a) => (
              <a key={a.id} href={href("alerts", a.id)} className="flex items-start gap-3 rounded-md p-2 hover:bg-muted">
                <span className="pt-1.5"><SeverityDot severity={a.severity} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.actor} · {shortResource(a.resource)}
                  </span>
                </span>
                <span className="text-xs whitespace-nowrap text-muted-foreground">{ago(a.detected_at)}</span>
              </a>
            ))}
          </CardContent>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard section="detections">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileCode2 className="size-4 text-section" />Alerts by rule</CardTitle>
            <CardDescription>Which detections fired</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(rules.data ?? []).map((r) => {
              const n = (alerts.data ?? []).filter((a) => a.rule_id === r.id).length
              const max = Math.max(1, ...(rules.data ?? []).map((x) => (alerts.data ?? []).filter((a) => a.rule_id === x.id).length))
              return (
                <a key={r.id} href={href("detections", r.id)} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-2 truncate text-sm">
                    <SeverityDot severity={r.severity} />
                    <Mono className="truncate">{r.id}</Mono>
                  </span>
                  <span className="text-sm tabular-nums">{n}</span>
                  <span className="col-span-2 h-1.5 rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-section" style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                </a>
              )
            })}
          </CardContent>
        </SectionCard>

        <SectionCard section="vulnerabilities">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bug className="size-4 text-section" />Vulnerabilities needing action</CardTitle>
            <CardDescription>{triage.data ? `${triage.data.mode} · ${triage.data.repos.join(", ")}` : "Triager"}</CardDescription>
            <CardAction>
              <a href={href("vulnerabilities")} className="text-sm text-info hover:underline">Backlog</a>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-1">
            {triage.error && <ErrorBox error={triage.error} />}
            {triage.data?.findings.slice(0, 5).map((f) => (
              <a key={f.key} href={href("vulnerabilities", f.key)} className="flex items-center gap-3 rounded-md p-2 hover:bg-muted">
                <PriorityBadge priority={f.priority} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{f.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{f.package} · {f.repo}</span>
                </span>
                {f.overdueDays > 0 ? (
                  <Badge variant="outline" className="border-sev-critical/30 text-sev-critical">{f.overdueDays}d late</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">due {f.due}</span>
                )}
              </a>
            ))}
          </CardContent>
        </SectionCard>
      </div>

      {bySeverity.some((b) => b.n) && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Severity mix:
          {bySeverity.filter((b) => b.n).map((b) => (
            <span key={b.s} className="flex items-center gap-1"><SeverityBadge severity={b.s} /> × {b.n}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function Flow({ status }: { status?: PipelineStatus }) {
  if (!status) return <Loading rows={1} />
  const gcp = status.source === "gcp"
  const stats = status.stats ?? {}
  const steps = gcp
    ? [
        { name: "Cloud Audit Logs", detail: "every GCP API call", ok: true },
        { name: "Log sink", detail: String(status.sink?.name ?? "missing"), ok: !status.sink?.error },
        { name: "Pub/Sub", detail: `push · DLQ after ${status.subscription?.maxDeliveryAttempts ?? "?"} tries`, ok: !status.subscription?.error },
        { name: "Cloud Run", detail: String(status.cloudRun?.latestReadyRevision ?? "unreachable"), ok: status.reachable },
        { name: "BigQuery", detail: `${stats.events ?? 0} events · ${stats.alerts ?? 0} alerts`, ok: !("error" in stats) },
      ]
    : [
        { name: "Simulator", detail: "make attack", ok: undefined },
        { name: "Pub/Sub emulator", detail: containerState(status, "pubsub"), ok: status.containers?.some((c) => c.name === "pubsub" && c.state === "running") },
        { name: "Pipeline", detail: status.reachable ? `${stats.processed ?? 0} processed` : "not running", ok: status.reachable },
        { name: ".data/*.jsonl", detail: `${stats.alerts ?? 0} alerts · ${stats.dead_lettered ?? 0} dead-lettered`, ok: status.reachable ? true : undefined },
      ]
  return (
    <ol className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
      {steps.map((s, i) => (
        <li key={s.name} className="flex flex-1 items-center gap-2">
          <div className="flex-1 rounded-lg border border-section/25 bg-section/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{s.name}</span>
              <Status ok={s.ok} label="" />
            </div>
            <div className="truncate text-xs text-muted-foreground">{s.detail}</div>
          </div>
          {i < steps.length - 1 && <span className="hidden text-muted-foreground lg:block">→</span>}
        </li>
      ))}
    </ol>
  )
}

function containerState(status: PipelineStatus, name: string) {
  const c = status.containers?.find((x) => x.name === name)
  return c ? `${c.state}${c.health ? ` · ${c.health}` : ""}` : "not running"
}
