import { Activity } from "lucide-react"
import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ExpandableRows } from "@/components/expandable-rows"
import { Code, Empty, ErrorBox, KV, Loading, Mono, OutcomeBadge, PageHeader, SeverityDot } from "@/components/falcon"
import { useApi, type DeadLetter, type FalconAlert, type FalconEvent } from "@/lib/api"
import { shortAction, shortResource, time } from "@/lib/format"
import { href, navigate } from "@/lib/router"

const PAGE = 200

export function Events({ openId }: { openId?: string }) {
  const events = useApi<FalconEvent[]>("events")
  const alerts = useApi<FalconAlert[]>("alerts")
  const dead = useApi<DeadLetter[]>("deadletters")
  const [q, setQ] = useState("")
  const [outcome, setOutcome] = useState("all")
  const [actorType, setActorType] = useState("all")
  const [limit, setLimit] = useState(PAGE)

  const alertsByEvent = useMemo(() => {
    const m = new Map<string, FalconAlert[]>()
    for (const a of alerts.data ?? []) m.set(a.event_id, [...(m.get(a.event_id) ?? []), a])
    return m
  }, [alerts.data])

  const actorTypes = useMemo(() => [...new Set((events.data ?? []).map((e) => e.actor_type).filter(Boolean))].sort(), [events.data])
  const rows = useMemo(() => {
    const needle = q.toLowerCase()
    return (events.data ?? []).filter(
      (e) =>
        (outcome === "all" || e.outcome === outcome) &&
        (actorType === "all" || e.actor_type === actorType) &&
        (!needle || [e.action, e.actor, e.resource, e.src_ip, e.service].some((v) => v?.toLowerCase().includes(needle))),
    )
  }, [events.data, q, outcome, actorType])
  // Keep an event opened from a link visible even if it is beyond the current page.
  const shown = useMemo(() => {
    const page = rows.slice(0, limit)
    const opened = rows.find((e) => e.id === openId)
    return opened && !page.includes(opened) ? [...page, opened] : page
  }, [rows, limit, openId])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Activity />}
        title="Events"
        description="Every audit log entry the pipeline received, normalized into one schema and enriched with actor type, IP class and IAM changes. Rules match against exactly these fields. Click an event to see its details."
      />
      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Events {events.data && <Badge variant="secondary">{events.data.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="dead">Dead letters {dead.data && <Badge variant="secondary">{dead.data.length}</Badge>}</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="space-y-4 pt-2">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Search action, actor, resource, IP…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any outcome</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failure">Denied</SelectItem>
              </SelectContent>
            </Select>
            <Select value={actorType} onValueChange={setActorType}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any actor type</SelectItem>
                {actorTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {events.error && <ErrorBox error={events.error} />}
          {events.loading && !events.data && <Loading rows={8} />}
          {events.data?.length === 0 && <Empty title="No events yet">Start the stack and replay an attack: <Mono>make up && make attack</Mono></Empty>}
          {!!events.data?.length && rows.length === 0 && <Empty title="No events match the filter" />}
          {shown.length > 0 && (
            <ExpandableRows
              items={shown}
              getId={(e) => e.id}
              openId={openId}
              onToggle={(id) => navigate("events", id)}
              grid="grid-cols-[1.5rem_minmax(0,1fr)_auto] lg:grid-cols-[1.5rem_11rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem_6rem]"
              header={
                <>
                  <span />
                  <span>Time</span>
                  <span>Action</span>
                  <span>Actor</span>
                  <span>Resource</span>
                  <span>Source IP</span>
                  <span>Outcome</span>
                </>
              }
              rowClassName={(e) => (alertsByEvent.has(e.id) ? "bg-sev-critical/5" : undefined)}
              row={(e) => {
                const hits = alertsByEvent.get(e.id)
                return (
                  <>
                    <span className="hidden text-sm whitespace-nowrap text-muted-foreground lg:block">{time(e.ts)}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        {hits && <SeverityDot severity={hits[0].severity} />}
                        <Mono className="truncate" title={e.action}>{shortAction(e.action)}</Mono>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {e.service}
                        <span className="lg:hidden"> · {time(e.ts)}</span>
                      </span>
                    </span>
                    <span className="hidden min-w-0 lg:block">
                      <span className="block truncate">{e.actor || "–"}</span>
                      <span className="block text-xs text-muted-foreground">{e.actor_type}</span>
                    </span>
                    <Mono className="hidden truncate lg:block">{shortResource(e.resource)}</Mono>
                    <span className="hidden lg:block">
                      <Mono className="block">{e.src_ip || "–"}</Mono>
                      <span className="block text-xs text-muted-foreground">{e.ip_class}</span>
                    </span>
                    <span><OutcomeBadge outcome={e.outcome} /></span>
                  </>
                )
              }}
              detail={(e) => <EventDetail event={e} alerts={alertsByEvent.get(e.id)} />}
              footer={
                <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
                  <span>Showing {Math.min(limit, rows.length)} of {rows.length}</span>
                  {rows.length > limit && <button className="text-info hover:underline" onClick={() => setLimit(limit + PAGE)}>Show more</button>}
                </div>
              }
            />
          )}
        </TabsContent>

        <TabsContent value="dead" className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Messages that were not valid audit log entries. They are acknowledged so Pub/Sub stops retrying, but kept here for inspection instead of being dropped.
          </p>
          {dead.error && <ErrorBox error={dead.error} />}
          {dead.data?.length === 0 && <Empty title="Nothing dead-lettered" />}
          {dead.data?.map((d) => (
            <div key={d.message_id + d.received_at} className="space-y-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-sev-medium">{d.error}</span>
                <span className="text-muted-foreground">{time(d.received_at)} · message <Mono>{d.message_id}</Mono></span>
              </div>
              <Code>{d.payload}</Code>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function EventDetail({ event, alerts }: { event: FalconEvent; alerts?: FalconAlert[] }) {
  return (
    <div className="grid gap-6 px-4 py-5 lg:grid-cols-2 lg:px-6">
      <div className="min-w-0 space-y-5">
        {alerts?.map((a) => (
          <a key={a.id} href={href("alerts", a.id)} className="flex items-center gap-2 rounded-md border border-sev-critical/30 bg-sev-critical/10 p-3 text-sm">
            <SeverityDot severity={a.severity} />
            This event raised <span className="font-medium">{a.title}</span>
          </a>
        ))}
        <KV
          rows={[
            ["Action", <Mono>{event.action}</Mono>],
            ["Time", `${time(event.ts)} · ${event.log_type?.replace("_", " ")} log`],
            ["Actor", `${event.actor || "–"} (${event.actor_type})`],
            ["Source IP", `${event.src_ip || "–"} (${event.ip_class})`],
            ["Resource", <Mono>{event.resource}</Mono>],
            ["Service", event.service],
            ["Outcome", <span className="flex items-center gap-2"><OutcomeBadge outcome={event.outcome} />{event.status_message && <span className="text-muted-foreground">{event.status_message}</span>}</span>],
            ["User agent", <span className="text-xs break-all">{event.user_agent || "–"}</span>],
            ["IAM changes", event.iam_deltas?.length ? (
              <ul className="space-y-1">
                {event.iam_deltas.map((d, i) => <li key={i}><Mono>{d.action} {d.role} → {d.member}</Mono></li>)}
              </ul>
            ) : "–"],
            ["Event ID", <Mono>{event.id}</Mono>],
          ]}
        />
      </div>
      <div className="min-w-0 space-y-2">
        <h3 className="font-semibold">Original Cloud Audit Log entry</h3>
        <Code>{JSON.stringify(event.raw, null, 2)}</Code>
      </div>
    </div>
  )
}
