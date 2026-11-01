import { AlertTriangle } from "lucide-react"
import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ExpandableRows } from "@/components/expandable-rows"
import { Code, Description, Empty, ErrorBox, KV, Loading, Markdown, Mitre, Mono, PageHeader, SeverityBadge } from "@/components/falcon"
import { useApi, type FalconAlert, type FalconEvent } from "@/lib/api"
import { ago, SEVERITY_ORDER, shortResource, time } from "@/lib/format"
import { href, navigate } from "@/lib/router"

export function Alerts({ openId }: { openId?: string }) {
  const alerts = useApi<FalconAlert[]>("alerts")
  const [q, setQ] = useState("")
  const [sev, setSev] = useState("all")

  const rows = useMemo(() => {
    const needle = q.toLowerCase()
    return (alerts.data ?? []).filter(
      (a) => (sev === "all" || a.severity === sev) && (!needle || [a.title, a.rule_id, a.actor, a.resource, a.src_ip].some((v) => v?.toLowerCase().includes(needle))),
    )
  }, [alerts.data, q, sev])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<AlertTriangle />}
        title="Alerts"
        description="Every time a detection rule matched an audit event. Each alert carries the actor, the resource, the MITRE ATT&CK technique and a runbook for the responder. Click an alert to see its details."
      />
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search actor, resource, rule, IP…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Select value={sev} onValueChange={setSev}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {SEVERITY_ORDER.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {alerts.error && <ErrorBox error={alerts.error} />}
      {alerts.loading && !alerts.data && <Loading />}
      {alerts.data?.length === 0 && (
        <Empty title="No alerts yet">
          Run <Mono>make up && make attack</Mono> locally, or trigger a detection in the GCP project.
        </Empty>
      )}
      {!!alerts.data?.length && rows.length === 0 && <Empty title="No alerts match the filter" />}
      {rows.length > 0 && (
        <ExpandableRows
          items={rows}
          getId={(a) => a.id}
          openId={openId}
          onToggle={(id) => navigate("alerts", id)}
          grid="grid-cols-[1.5rem_minmax(0,1fr)_auto] lg:grid-cols-[1.5rem_6.5rem_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_6rem_6rem]"
          header={
            <>
              <span />
              <span>Severity</span>
              <span>Alert</span>
              <span>Actor</span>
              <span>Resource</span>
              <span>ATT&CK</span>
              <span className="text-right">Detected</span>
            </>
          }
          row={(a) => (
            <>
              <span className="hidden lg:block"><SeverityBadge severity={a.severity} /></span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{a.title}</span>
                  <span className="lg:hidden"><SeverityBadge severity={a.severity} /></span>
                </span>
                <Mono className="block truncate text-muted-foreground">{a.rule_id}</Mono>
              </span>
              <span className="hidden truncate lg:block">{a.actor}</span>
              <Mono className="hidden truncate lg:block">{shortResource(a.resource)}</Mono>
              <span className="hidden lg:block" onClick={(e) => e.stopPropagation()}><Mitre ids={a.mitre ?? []} /></span>
              <span className="text-right text-sm whitespace-nowrap text-muted-foreground" title={time(a.detected_at)}>{ago(a.detected_at)}</span>
            </>
          )}
          detail={(a) => <AlertDetail alert={a} />}
        />
      )}
    </div>
  )
}

function AlertDetail({ alert }: { alert: FalconAlert }) {
  const runbooks = useApi<Record<string, string>>("runbooks")
  const events = useApi<FalconEvent[]>("events")
  const event = events.data?.find((e) => e.id === alert.event_id)
  const latency = (new Date(alert.detected_at).getTime() - new Date(alert.event_ts).getTime()) / 1000

  return (
    <div className="grid gap-6 px-4 py-5 lg:grid-cols-2 lg:px-6">
      <div className="min-w-0 space-y-5">
        <Description text={alert.description} />
        <KV
          rows={[
            ["Rule", <a href={href("detections", alert.rule_id)} className="font-mono text-xs text-info hover:underline">{alert.rule_id}</a>],
            ["Actor", alert.actor],
            ["Action", <Mono>{alert.action}</Mono>],
            ["Resource", <Mono>{alert.resource}</Mono>],
            ["Project", alert.project],
            ["Source IP", <Mono>{alert.src_ip || "–"}</Mono>],
            ["ATT&CK", <Mitre ids={alert.mitre ?? []} />],
            ["Happened", time(alert.event_ts)],
            ["Detected", `${time(alert.detected_at)} (${latency.toFixed(1)} s later)`],
            ["Alert ID", <Mono>{alert.id}</Mono>],
          ]}
        />
        <section className="space-y-3">
          <h3 className="font-semibold">Runbook</h3>
          {runbooks.data?.[alert.rule_id] ? <Markdown text={runbooks.data[alert.rule_id]} /> : <p className="text-sm text-muted-foreground">No runbook section.</p>}
          {runbooks.data?._general && (
            <details className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer font-medium">First steps for every alert</summary>
              <div className="mt-3"><Markdown text={runbooks.data._general} /></div>
            </details>
          )}
        </section>
      </div>
      <div className="min-w-0 space-y-3">
        <h3 className="font-semibold">Triggering event</h3>
        {event ? (
          <>
            <p className="text-sm text-muted-foreground">
              As normalized by the pipeline. <a href={href("events", event.id)} className="text-info hover:underline">Open in Events</a>
            </p>
            <Code>{JSON.stringify({ ...event, raw: undefined }, null, 2)}</Code>
            <details>
              <summary className="cursor-pointer text-sm font-medium">Original Cloud Audit Log entry</summary>
              <Code className="mt-2">{JSON.stringify(event.raw, null, 2)}</Code>
            </details>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{events.loading ? "Loading…" : "Event not in the most recent events."} ID <Mono>{alert.event_id}</Mono></p>
        )}
      </div>
    </div>
  )
}
