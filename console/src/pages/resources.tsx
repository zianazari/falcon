import { Gauge } from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Empty, ErrorBox, GaugeStat, Loading, Mono, PageHeader, SectionCard, Stat, Status } from "@/components/falcon"
import { useApi, type MetricResult, type MetricSeries, type ResourceTable, type Resources, type SchedulerJob } from "@/lib/api"
import { ago, time } from "@/lib/format"

const COLORS = ["var(--section)", "oklch(0.62 0.2 25)", "oklch(0.65 0.16 60)", "oklch(0.58 0.15 240)"]

const bytes = (n = 0) => {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length)
  return `${(n / 1024 ** i).toFixed(1)} ${units[i - 1]}`
}

const percent = (v: number) => `${(v * 100).toFixed(1)}%`
const count = (v: number) => (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1))
const ms = (v: number) => `${Math.round(v)} ms`
const seconds = (v: number) => `${Math.round(v)} s`

function latest(r: MetricResult | undefined): number | undefined {
  if (!Array.isArray(r) || !r.length) return undefined
  // Series may end at different times, so each contributes its own last point.
  return r.reduce((sum, s) => sum + (s.points.at(-1)?.v ?? 0), 0)
}

function MetricChart({ title, description, result, format, section }: { title: string; description: string; result?: MetricResult; format: (v: number) => string; section: string }) {
  const series: MetricSeries[] = Array.isArray(result) ? result : []
  const { rows, config } = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string>>()
    const config: ChartConfig = {}
    series.forEach((s, i) => {
      const key = `s${i}`
      config[key] = { label: s.label === "value" ? title : s.label, color: COLORS[i % COLORS.length] }
      for (const p of s.points) {
        const row = byTime.get(p.t) ?? { t: p.t, label: new Date(p.t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) }
        row[key] = p.v
        byTime.set(p.t, row)
      }
    })
    return { rows: [...byTime.values()].sort((a, b) => String(a.t).localeCompare(String(b.t))), config }
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SectionCard section={section}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {result && !Array.isArray(result) ? (
          <ErrorBox error={result.error} />
        ) : rows.length ? (
          <ChartContainer config={config} className="h-52 w-full">
            <LineChart data={rows} margin={{ left: 4, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis width={72} tickLine={false} axisLine={false} tickFormatter={format} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
              {series.map((_, i) => (
                <Line key={i} dataKey={`s${i}`} stroke={`var(--color-s${i})`} strokeWidth={2} dot={rows.length < 12} type="linear" isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ChartContainer>
        ) : (
          <p className="py-14 text-center text-sm text-muted-foreground">No data in this period.</p>
        )}
      </CardContent>
    </SectionCard>
  )
}

const value = (v: number | undefined, format: (n: number) => string) => (v === undefined ? "–" : format(v))

/** Draws "7.653GiB" or "3 hours" as a large number with a small unit. */
function Quantity({ text }: { text: string }) {
  const match = /^([\d.]+)\s*(.+)$/.exec(text)
  if (!match) return text || "–"
  return (
    <>
      {Number(Number(match[1]).toFixed(1))} <span className="text-lg font-medium text-muted-foreground">{match[2]}</span>
    </>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function ResourcesPage() {
  const [hours, setHours] = useState("1")
  const res = useApi<Resources>(`resources?hours=${hours}`)
  const d = res.data

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Gauge />}
        title="Resources"
        description="How the infrastructure behind Falcon is doing: compute, message queues, stored data and scheduled jobs. Cloud metrics come from Cloud Monitoring and can lag by a few minutes."
        actions={
          d?.source === "gcp" && (
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last hour</SelectItem>
                <SelectItem value="6">Last 6 hours</SelectItem>
                <SelectItem value="24">Last 24 hours</SelectItem>
              </SelectContent>
            </Select>
          )
        }
      />
      {res.error && <ErrorBox error={res.error} />}
      {res.loading && !d && <Loading rows={6} />}
      {d?.source === "local" && <Local d={d} />}
      {d?.source === "gcp" && <Cloud d={d} />}
    </div>
  )
}

function Local({ d }: { d: Resources }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">Local mode shows Docker containers. Start the console with <Mono>make console-gcp</Mono> to see cloud resources.</p>
      {d.containers?.length ? (
        d.containers.map((c) => (
          <Group key={c.name} title={c.name}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Stat section="pipeline" label="Uptime" value={<Quantity text={c.uptime} />} hint={c.health ?? "no health check"} />
              <Stat section="pipeline" label="Processors" value={value(d.cpus, count)} hint="shared with other containers" />
              <Stat section="pipeline" label="RAM" value={<Quantity text={c.memoryLimit} />} hint="available to this container" />
              {/* Docker reports CPU against a single core, so a busy container can exceed 100%. */}
              <GaugeStat section="pipeline" label="CPU load" percent={d.cpus ? c.cpuPercent / d.cpus : undefined} hint={d.cpus ? `across ${d.cpus} processors` : undefined} />
              <GaugeStat section="pipeline" label="Memory use" percent={c.memoryPercent} hint={`${c.memoryUsed} used`} />
            </div>
            <p className="text-sm text-muted-foreground">Network in / out: {c.network}</p>
            {c.name.includes("pubsub") && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <Stat section="events" label="Processed" value={value(d.messages?.processed, count)} hint="since the pipeline last started" />
                <Stat section="events" label="Waiting" value="N/A" hint="the emulator does not report queue depth" />
                <Stat section="events" label="Dead-lettered" value={value(d.messages?.dead_lettered, count)} tone={(d.messages?.dead_lettered ?? 0) > 0 ? "bad" : undefined} hint="unparseable, kept for inspection" />
                <Stat section="events" label="Errors" value={value(d.messages?.errors, count)} tone={(d.messages?.errors ?? 0) > 0 ? "bad" : undefined} hint="failed deliveries, retried by Pub/Sub" />
                <Stat section="events" label="Duplicates" value={value(d.messages?.duplicates, count)} hint="redelivered and ignored" />
              </div>
            )}
          </Group>
        ))
      ) : (
        <Empty title="No Falcon containers are running">Start them with <Mono>make up</Mono>.</Empty>
      )}
    </>
  )
}

function Cloud({ d }: { d: Resources }) {
  const m = d.metrics ?? {}
  const tables = Array.isArray(d.tables) ? d.tables : []
  const jobs = Array.isArray(d.scheduler) ? d.scheduler : []
  const nothingDeployed = tables.length > 0 && tables.every((t) => !t.exists)
  // Monitoring keeps history after teardown, so old readings must not look current.
  const now = (r: MetricResult | undefined) => (nothingDeployed ? undefined : latest(r))
  const scaled = (v: number | undefined) => (v === undefined ? undefined : v * 100)
  const tile = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
  const chart = "grid gap-6 xl:grid-cols-2"

  return (
    <div className="space-y-8">
      {nothingDeployed && (
        <div className="rounded-lg border border-section/30 bg-section/10 p-4 text-sm">
          Falcon is not deployed in {d.project} right now. Charts show recent history, and current values stay empty until it is deployed.
        </div>
      )}

      <Group title="Cloud Run: pipeline">
        <div className={tile}>
          <Stat section="pipeline" label="Instances" value={value(now(m.instances), count)} hint="latest reading, scales to zero when idle" />
          <GaugeStat section="pipeline" label="CPU, 95th percentile" percent={scaled(now(m.cpu))} hint="of the 1 vCPU limit" />
          <GaugeStat section="pipeline" label="Memory, 95th percentile" percent={scaled(now(m.memory))} hint="of the 512 MB limit" />
          <Stat section="pipeline" label="Latency, 95th percentile" value={value(now(m.latency), ms)} hint="per pushed message" />
        </div>
        <div className={chart}>
          <MetricChart section="pipeline" title="CPU" description="95th percentile utilization" result={m.cpu} format={percent} />
          <MetricChart section="pipeline" title="Memory" description="95th percentile utilization" result={m.memory} format={percent} />
          <MetricChart section="pipeline" title="Instances" description="Running instances by state" result={m.instances} format={count} />
          <MetricChart section="pipeline" title="Requests" description="By response class, per period" result={m.requests} format={count} />
        </div>
      </Group>

      <Group title="Pub/Sub and log export">
        <div className={tile}>
          <Stat section="events" label="Messages waiting" value={value(now(m.backlog), count)} hint="not yet acknowledged by the pipeline" />
          <Stat section="events" label="Oldest message" value={value(now(m.oldest), seconds)} tone={(now(m.oldest) ?? 0) > 300 ? "bad" : undefined} hint="age of the oldest unacknowledged message" />
          <Stat section="events" label="Dead-letter queue" value={value(now(m.dlq), count)} tone={(now(m.dlq) ?? 0) > 0 ? "bad" : undefined} hint="messages that failed all 5 attempts" />
          <Stat section="events" label="Export errors" value={value(now(m.exportErrors), count)} tone={(now(m.exportErrors) ?? 0) > 0 ? "bad" : undefined} hint="latest period, log sink to Pub/Sub" />
        </div>
        <div className={chart}>
          <MetricChart section="events" title="Messages waiting" description="Backlog on the push subscription" result={m.backlog} format={count} />
          <MetricChart section="events" title="Push deliveries" description="By result, per period" result={m.pushes} format={count} />
          <MetricChart section="events" title="Log entries exported" description="Sent by the sink, per period" result={m.exported} format={count} />
          <MetricChart section="events" title="Dead-letter queue" description="Messages waiting for inspection" result={m.dlq} format={count} />
        </div>
      </Group>

      <Group title="BigQuery: falcon_security">
        {!Array.isArray(d.tables) && d.tables ? <ErrorBox error={d.tables.error} /> : <TablesView tables={tables} />}
      </Group>

      <Group title="Scheduled jobs and storage">
        {d.scheduler && !Array.isArray(d.scheduler) ? <ErrorBox error={d.scheduler.error} /> : <JobsView jobs={jobs} />}
        {d.registry && "error" in d.registry ? (
          <ErrorBox error={d.registry.error} />
        ) : (
          <p className="text-sm text-muted-foreground">Artifact Registry: {d.registry ? bytes(d.registry.sizeBytes) : "no repository"}</p>
        )}
      </Group>
    </div>
  )
}

function TablesView({ tables }: { tables: ResourceTable[] }) {
  if (!tables.some((t) => t.exists)) return <Empty title="The dataset does not exist" />
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader className="bg-section/10">
          <TableRow><TableHead>Table</TableHead><TableHead>Rows</TableHead><TableHead>Streaming buffer</TableHead><TableHead>Size</TableHead><TableHead>Last changed</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {tables.map((t) => (
            <TableRow key={t.name}>
              <TableCell><Mono>{t.name}</Mono></TableCell>
              <TableCell>{t.rows?.toLocaleString()}</TableCell>
              <TableCell>{t.buffered?.toLocaleString()}</TableCell>
              <TableCell>{bytes(t.bytes)}</TableCell>
              <TableCell>{t.modified ? ago(new Date(t.modified).toISOString()) : "–"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function JobsView({ jobs }: { jobs: SchedulerJob[] }) {
  if (!jobs.length) return <Empty title="No scheduled jobs" />
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader className="bg-section/10">
          <TableRow><TableHead>Job</TableHead><TableHead>State</TableHead><TableHead>Schedule</TableHead><TableHead>Last run</TableHead><TableHead>Result</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((j) => (
            <TableRow key={j.name}>
              <TableCell><Mono>{j.name}</Mono></TableCell>
              <TableCell>{j.state}</TableCell>
              <TableCell><Mono>{j.schedule}</Mono></TableCell>
              <TableCell title={time(j.lastAttempt)}>{ago(j.lastAttempt)}</TableCell>
              <TableCell><Status ok={j.status === 0} label={j.status === 0 ? "OK" : `Code ${j.status}`} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
