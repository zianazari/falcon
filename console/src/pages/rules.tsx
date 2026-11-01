import { ScrollText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ExpandableRows } from "@/components/expandable-rows"
import { Code, Description, ErrorBox, KV, Loading, Mitre, Mono, PageHeader, SeverityBadge } from "@/components/falcon"
import { useApi, type Rule } from "@/lib/api"
import { navigate } from "@/lib/router"

export function Rules({ openId }: { openId?: string }) {
  const rules = useApi<Rule[]>("rules")

  return (
    <div className="space-y-6">
      <PageHeader icon={<ScrollText />} title="Rules" description="What each rule looks for. Click a rule to read its definition." />

      {rules.error && <ErrorBox error={rules.error} />}
      {rules.loading && !rules.data && <Loading rows={6} />}
      {rules.data && (
        <ExpandableRows
          items={rules.data}
          getId={(r) => r.id}
          openId={openId}
          onToggle={(id) => navigate("rules", id)}
          grid="grid-cols-[1.5rem_minmax(0,1fr)] lg:grid-cols-[1.5rem_6.5rem_minmax(0,1fr)_7rem]"
          header={
            <>
              <span />
              <span>Severity</span>
              <span>Rule</span>
              <span>ATT&CK</span>
            </>
          }
          row={(r) => <RuleCells rule={r} />}
          detail={(r) => <RuleDefinition rule={r} />}
        />
      )}
    </div>
  )
}

function RuleCells({ rule }: { rule: Rule }) {
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
    </>
  )
}

function RuleDefinition({ rule }: { rule: Rule }) {
  return (
    <div className="min-w-0 space-y-5 px-4 py-5 lg:px-6">
      <Description text={rule.description} />
      <KV rows={[["File", <Mono>{rule.file}</Mono>], ["ATT&CK", <Mitre ids={rule.mitre} />]]} />
      <section className="space-y-2">
        <h3 className="font-semibold">Rule</h3>
        <Code className="max-h-none whitespace-pre-wrap">{rule.yaml}</Code>
      </section>
    </div>
  )
}
