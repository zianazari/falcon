import { Workflow } from "lucide-react"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Code, Empty, ErrorBox, KV, Loading, Mono, PageHeader, SectionCard, Status } from "@/components/falcon"
import { useApi, type PipelineStatus } from "@/lib/api"
import { ago, time } from "@/lib/format"

export function Pipeline() {
  const p = useApi<PipelineStatus>("pipeline")
  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Workflow />}
        title="Pipeline"
        description="The live state of each stage: where audit logs are exported, how they are delivered, what runs the detection code, and where the results are stored."
      />
      {p.error && <ErrorBox error={p.error} />}
      {p.loading && !p.data && <Loading rows={6} />}
      {p.data?.source === "gcp" && <Gcp p={p.data} />}
      {p.data?.source === "local" && <Local p={p.data} />}
    </div>
  )
}

function Err({ v }: { v?: Record<string, unknown> }) {
  return v && "error" in v ? <ErrorBox error={String(v.error)} /> : null
}

function Gcp({ p }: { p: PipelineStatus }) {
  const run = p.cloudRun ?? {}
  const stats = p.stats ?? {}
  const conditions = (run.conditions as { type: string; state: string }[] | undefined) ?? []
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <SectionCard section="pipeline">
        <CardHeader>
          <CardTitle>1 · Log sink</CardTitle>
          <CardDescription>Exports every Cloud Audit Log entry in the project</CardDescription>
        </CardHeader>
        <CardContent>
          <Err v={p.sink} />
          {!p.sink?.error && (
            <KV rows={[["Name", <Mono>{String(p.sink?.name)}</Mono>], ["Filter", <Mono>{String(p.sink?.filter)}</Mono>], ["Destination", <Mono>{String(p.sink?.destination)}</Mono>], ["Writer identity", <Mono>{String(p.sink?.writer)}</Mono>]]} />
          )}
        </CardContent>
      </SectionCard>
      <SectionCard section="pipeline">
        <CardHeader>
          <CardTitle>2 · Pub/Sub push subscription</CardTitle>
          <CardDescription>Delivers each entry to Cloud Run with an OIDC token; retries with backoff</CardDescription>
        </CardHeader>
        <CardContent>
          <Err v={p.subscription} />
          {!p.subscription?.error && (
            <KV
              rows={[
                ["Subscription", <Mono>{String(p.subscription?.name)}</Mono>],
                ["Push endpoint", <Mono>{String(p.subscription?.endpoint)}</Mono>],
                ["Ack deadline", `${p.subscription?.ackDeadlineSeconds}s`],
                ["Dead-letter topic", <Mono>{String(p.subscription?.deadLetterTopic)}</Mono>],
                ["Max attempts", String(p.subscription?.maxDeliveryAttempts)],
                ["Dead-lettered", String(p.deadLettered ?? 0)],
              ]}
            />
          )}
        </CardContent>
      </SectionCard>
      <SectionCard section="pipeline">
        <CardHeader>
          <CardTitle>3 · Cloud Run: detection pipeline</CardTitle>
          <CardDescription>Go service; normalizes, enriches, runs the YAML rules, writes results</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Err v={run} />
          {!run.error && (
            <>
              <div className="flex flex-wrap gap-4">
                {conditions.map((c) => <Status key={c.type} ok={c.state === "CONDITION_SUCCEEDED"} label={c.type} />)}
              </div>
              <KV
                rows={[
                  ["Service", <Mono>{String(run.name)}</Mono>],
                  ["Revision", <Mono>{String(run.latestReadyRevision)}</Mono>],
                  ["Image", <Mono className="break-all">{String(run.image)}</Mono>],
                  ["Ingress", <span>{String(run.ingress) === "INGRESS_TRAFFIC_INTERNAL_ONLY" ? "Internal only (not reachable from the internet)" : String(run.ingress)}</span>],
                  ["Deployed", `${time(String(run.updateTime))} (${ago(String(run.updateTime))})`],
                ]}
              />
            </>
          )}
        </CardContent>
      </SectionCard>
      <SectionCard section="pipeline">
        <CardHeader>
          <CardTitle>4 · BigQuery</CardTitle>
          <CardDescription>Dataset <Mono>falcon_security</Mono>: every event, alert and dead letter</CardDescription>
        </CardHeader>
        <CardContent>
          {"error" in stats ? (
            <ErrorBox error={String(stats.error)} />
          ) : (
            <KV
              rows={[
                ["events", Number(stats.events ?? 0).toLocaleString()],
                ["alerts", Number(stats.alerts ?? 0).toLocaleString()],
                ["deadletter", Number(stats.dead_lettered ?? 0).toLocaleString()],
                ["Last event", stats.last_event ? `${time(String(stats.last_event))} (${ago(String(stats.last_event))})` : "–"],
              ]}
            />
          )}
        </CardContent>
      </SectionCard>
      {p.terraform && Object.keys(p.terraform).length > 0 && (
        <SectionCard section="pipeline" className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Terraform outputs</CardTitle>
            <CardDescription><Mono>infra/terraform/envs/dev</Mono> · project {p.project}, region {p.region}</CardDescription>
          </CardHeader>
          <CardContent>
            <Code>{JSON.stringify(p.terraform, null, 2)}</Code>
          </CardContent>
        </SectionCard>
      )}
    </div>
  )
}

function Local({ p }: { p: PipelineStatus }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <SectionCard section="pipeline">
        <CardHeader>
          <CardTitle>Containers</CardTitle>
          <CardDescription><Mono>docker compose</Mono>: Pub/Sub emulator and the pipeline</CardDescription>
        </CardHeader>
        <CardContent>
          {p.containers?.length ? (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Service</TableHead><TableHead>State</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {p.containers.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell><Status ok={c.state === "running"} label={c.health ? `${c.state} · ${c.health}` : c.state} /></TableCell>
                    <TableCell className="text-muted-foreground">{c.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty title="The local stack is not running">Start it with <Mono>make up</Mono>, then replay an attack with <Mono>make attack</Mono>.</Empty>
          )}
        </CardContent>
      </SectionCard>
      <SectionCard section="pipeline">
        <CardHeader>
          <CardTitle>Pipeline counters</CardTitle>
          <CardDescription><Mono>GET localhost:8080/stats</Mono></CardDescription>
        </CardHeader>
        <CardContent>
          {p.reachable && p.stats ? (
            <KV rows={Object.entries(p.stats).map(([k, v]) => [k, String(v)])} />
          ) : (
            <p className="text-sm text-muted-foreground">Pipeline not reachable. Results already written to <Mono>{p.dataDir}</Mono> are still shown on the other pages.</p>
          )}
        </CardContent>
      </SectionCard>
    </div>
  )
}
