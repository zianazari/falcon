import { FileCode2, FlaskConical, Loader2 } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExpandableRows } from "@/components/expandable-rows"
import { Code, Description, Empty, ErrorBox, KV, Loading, Markdown, Mitre, Mono, PageHeader, SeverityBadge, Status } from "@/components/falcon"
import { api, useApi, type DetectionTestRun, type FalconAlert, type FixtureResult, type Rule } from "@/lib/api"
import { ago, time } from "@/lib/format"
import { href, navigate } from "@/lib/router"

export function Detections({ openId }: { openId?: string }) {
  const rules = useApi<Rule[]>("rules")
  const alerts = useApi<FalconAlert[]>("alerts")
  const [run, setRun] = useState<DetectionTestRun>()
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string>()

  async function runTests() {
    setRunning(true)
    setRunError(undefined)
    try {
      setRun(await api<DetectionTestRun>("detections/test", { method: "POST" }))
    } catch (e) {
      setRunError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  // Until alerts load, an empty list would wrongly mean "nothing has fired".
  const fired = rules.data && alerts.data && rules.data.filter((r) => alerts.data!.some((a) => a.rule_id === r.id))
  const passed = run?.results.filter((r) => r.status === "PASS").length ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<FileCode2 />}
        title="Detections"
        description={<>The rules that have raised at least one alert. Click a rule to see its details. All rules, including those that have not fired, are under <a href={href("rules")} className="text-info hover:underline">Rules</a>.</>}
        actions={
          <Button onClick={runTests} disabled={running} className="bg-section text-white hover:bg-section/90">
            {running ? <Loader2 className="animate-spin" /> : <FlaskConical />}
            {running ? "Running fixtures…" : "Run fixture tests"}
          </Button>
        }
      />

      {runError && <ErrorBox error={runError} />}
      {run && (
        <div className={`rounded-lg border p-4 text-sm ${run.ok ? "border-ok/30 bg-ok/10" : "border-sev-critical/30 bg-sev-critical/10"}`}>
          <Status ok={run.ok} label={`${passed} of ${run.results.length} fixtures passed`} />
          <span className="ml-2 text-muted-foreground">
            <Mono>go run ./cmd/detect test</Mono> · {time(run.ranAt)}
          </span>
        </div>
      )}

      {rules.error && <ErrorBox error={rules.error} />}
      {alerts.error && <ErrorBox error={alerts.error} />}
      {!fired && !rules.error && !alerts.error && <Loading rows={6} />}
      {fired && !fired.length && (
        <Empty title="No rule has fired yet">Every rule is still listed under <a href={href("rules")} className="text-info hover:underline">Rules</a>.</Empty>
      )}
      {fired && fired.length > 0 && <RuleList rules={fired} alerts={alerts.data ?? []} results={run?.results ?? []} openId={openId} />}
    </div>
  )
}

function RuleList({ rules, alerts, results, openId }: { rules: Rule[]; alerts: FalconAlert[]; results: FixtureResult[]; openId?: string }) {
  const resultsFor = (id: string) => results.filter((r) => r.rule === id)
  const alertsFor = (id: string) => alerts.filter((a) => a.rule_id === id)

  return (
    <ExpandableRows
      items={rules}
      getId={(r) => r.id}
      openId={openId}
      onToggle={(id) => navigate("detections", id)}
      grid="grid-cols-[1.5rem_minmax(0,1fr)] lg:grid-cols-[1.5rem_6.5rem_minmax(0,1fr)_7rem_9rem_10rem]"
      header={
        <>
          <span />
          <span>Severity</span>
          <span>Rule</span>
          <span>ATT&CK</span>
          <span>Fixtures</span>
          <span>Activity</span>
        </>
      }
      row={(r) => <RuleCells rule={r} alerts={alertsFor(r.id)} results={resultsFor(r.id)} />}
      detail={(r) => <RuleDetail rule={r} alerts={alertsFor(r.id)} results={resultsFor(r.id)} />}
    />
  )
}

function RuleCells({ rule, alerts, results }: { rule: Rule; alerts: FalconAlert[]; results: FixtureResult[] }) {
  const fixtures = rule.fixtures.should_fire.length + rule.fixtures.should_not_fire.length
  return (
    <>
      <span className="hidden lg:block"><SeverityBadge severity={rule.severity} /></span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{rule.title}</span>
          <span className="lg:hidden"><SeverityBadge severity={rule.severity} /></span>
          {!rule.enabled && <Badge variant="secondary">disabled</Badge>}
        </span>
        <Mono className="block truncate text-muted-foreground">{rule.id}</Mono>
      </span>
      <span className="hidden lg:block" onClick={(e) => e.stopPropagation()}><Mitre ids={rule.mitre} /></span>
      <span className="hidden text-sm lg:block">
        {results.length ? (
          <Status ok={results.every((x) => x.status === "PASS")} label={`${results.filter((x) => x.status === "PASS").length}/${results.length} pass`} />
        ) : (
          <span className="text-muted-foreground">{fixtures} fixtures</span>
        )}
      </span>
      <span className="hidden text-sm lg:block">
        {alerts.length ? <span className="text-sev-critical">Fired {alerts.length}× · {ago(alerts[0].detected_at)}</span> : <span className="text-muted-foreground">Has not fired</span>}
      </span>
    </>
  )
}

function RuleDetail({ rule, results, alerts }: { rule: Rule; results: FixtureResult[]; alerts: FalconAlert[] }) {
  const runbooks = useApi<Record<string, string>>("runbooks")
  const status = (fixture: string) => results.find((r) => r.fixture === fixture)

  return (
    <div className="grid gap-6 px-4 py-5 lg:grid-cols-2 lg:px-6">
      <div className="min-w-0 space-y-5">
        <Description text={rule.description} />
        <KV
          rows={[
            ["File", <Mono>{rule.file}</Mono>],
            ["ATT&CK", <Mitre ids={rule.mitre} />],
            ["Enabled", rule.enabled ? "yes" : "no"],
            ["Alerts raised", alerts.length],
          ]}
        />
        <section className="space-y-2">
          <h3 className="font-semibold">Rule</h3>
          <Code className="max-h-none whitespace-pre-wrap">{rule.yaml}</Code>
        </section>
      </div>
      <div className="min-w-0 space-y-5">
        <section className="space-y-3">
          <h3 className="font-semibold">Test fixtures</h3>
          {(["should_fire", "should_not_fire"] as const).map((kind) => (
            <div key={kind} className="space-y-1">
              <p className="text-sm text-muted-foreground">{kind === "should_fire" ? "Must raise an alert" : "Must stay quiet (near-misses)"}</p>
              {rule.fixtures[kind].map((f) => {
                const r = status(f)
                return (
                  <div key={f} className="flex items-center justify-between rounded-md border px-3 py-1.5">
                    <Mono>{f}</Mono>
                    {r ? <Status ok={r.status === "PASS"} label={r.status} /> : <span className="text-xs text-muted-foreground">not run</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </section>
        {alerts.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-semibold">Recent alerts</h3>
            {alerts.slice(0, 5).map((a) => (
              <a key={a.id} href={href("alerts", a.id)} className="flex justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                <span className="truncate">{a.actor}</span>
                <span className="text-muted-foreground">{ago(a.detected_at)}</span>
              </a>
            ))}
          </section>
        )}
        <section className="space-y-2">
          <h3 className="font-semibold">Runbook</h3>
          {runbooks.data?.[rule.id] ? <Markdown text={runbooks.data[rule.id]} /> : <p className="text-sm text-muted-foreground">No runbook section.</p>}
        </section>
      </div>
    </div>
  )
}
