import { createContext, useCallback, useContext, useEffect, useState } from "react"

export type Severity = "critical" | "high" | "medium" | "low"

export interface Meta {
  source: "local" | "gcp"
  label: string
  project?: string
  region?: string
  generatedAt: string
}

export interface IamDelta {
  action: string
  role: string
  member: string
}

export interface FalconEvent {
  id: string
  ts: string
  received_at: string
  source: string
  log_type: string
  service: string
  action: string
  resource: string
  project: string
  actor: string
  actor_type: string
  src_ip: string
  ip_class: string
  user_agent: string
  outcome: "success" | "failure"
  status_code: number
  status_message?: string
  severity: string
  iam_deltas?: IamDelta[]
  raw: unknown
}

export interface FalconAlert {
  id: string
  rule_id: string
  title: string
  severity: Severity
  mitre: string[]
  runbook?: string
  event_id: string
  event_ts: string
  detected_at: string
  actor: string
  action: string
  resource: string
  project: string
  src_ip: string
  description: string
}

export interface DeadLetter {
  received_at: string
  message_id: string
  error: string
  payload: string
}

export interface Rule {
  id: string
  title: string
  description: string
  severity: Severity
  mitre: string[]
  runbook: string
  enabled: boolean
  file: string
  yaml: string
  fixtures: { should_fire: string[]; should_not_fire: string[] }
}

export interface FixtureResult {
  status: "PASS" | "FAIL"
  rule: string
  expect: "fire" | "no-fire"
  fixture: string
  detail: string
}

export interface DetectionTestRun {
  ok: boolean
  results: FixtureResult[]
  output: string
  ranAt: string
}

export type Priority = "P1" | "P2" | "P3" | "P4"

export interface TriageFinding {
  key: string
  repo: string
  source: "dependabot" | "code-scanning"
  number: number
  title: string
  severity: Severity
  path: string
  priority: Priority
  score: number
  reasons: string[]
  owners: string[]
  due: string
  overdueDays: number
  package: string
  ecosystem: string
  cve: string | null
  url: string
}

export interface TriageAction {
  kind: "create" | "update" | "nudge" | "reopen" | "close" | "report-only" | "ok"
  key: string
  issue: string | null
  repo: string | null
  from: string | null
  reason: string | null
}

export interface Triage {
  mode: string
  repos: string[]
  now: string
  findings: TriageFinding[]
  actions: TriageAction[]
  gate: { passed: boolean; detail: unknown }
}

export interface PipelineStatus {
  source: "local" | "gcp"
  reachable: boolean
  stats: Record<string, unknown> | null
  // local
  containers?: { name: string; state: string; health: string; status: string; image: string }[]
  dataDir?: string
  // gcp
  project?: string
  region?: string
  cloudRun?: Record<string, unknown>
  sink?: Record<string, unknown>
  subscription?: Record<string, unknown>
  deadLettered?: number
  terraform?: Record<string, unknown>
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, init)
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? res.statusText)
  return body as T
}

// One shared refresh counter: bumping it refetches every mounted query.
export const RefreshContext = createContext<{ tick: number; refresh: () => void }>({ tick: 0, refresh: () => {} })

export function useApi<T>(path: string) {
  const { tick } = useContext(RefreshContext)
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    let live = true
    setLoading(true)
    api<T>(path)
      .then((d) => {
        if (!live) return
        setData(d)
        setError(undefined)
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [path])

  useEffect(() => load(), [load, tick])
  return { data, error, loading }
}
