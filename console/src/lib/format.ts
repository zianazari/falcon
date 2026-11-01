export function time(iso?: string) {
  if (!iso) return "–"
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export function ago(iso?: string, now = Date.now()) {
  if (!iso) return "–"
  const s = Math.round((now - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

/** "google.iam.admin.v1.CreateServiceAccountKey" -> "CreateServiceAccountKey" */
export function shortAction(action: string) {
  const parts = action.split(".")
  return parts.length > 2 ? parts.slice(-1)[0] : action
}

/** "projects/_/buckets/x" -> "buckets/x" */
export function shortResource(resource: string) {
  return resource.replace(/^projects\/[^/]+\//, "")
}

export const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const
