// Terms highlighted in rule descriptions and runbooks, with a short explanation for the reader.
// "gcp": a name with a specific meaning in Google Cloud. "security": a security concept.
export type TermKind = "gcp" | "security"

export interface GlossaryEntry {
  kind: TermKind
  meaning: string
}

const ENTRIES: { terms: string[]; kind: TermKind; meaning: string }[] = [
  { terms: ["allUsers"], kind: "gcp", meaning: "Anyone on the internet, with no login at all." },
  { terms: ["allAuthenticatedUsers"], kind: "gcp", meaning: "Anyone with any Google account, not only people in your organization. Effectively public." },
  { terms: ["0.0.0.0/0"], kind: "gcp", meaning: "Every IPv4 address: the whole internet." },
  { terms: ["log sink"], kind: "gcp", meaning: "A rule that routes matching log entries to a destination such as Pub/Sub or BigQuery." },
  { terms: ["audit sink"], kind: "gcp", meaning: "The log sink that exports Cloud Audit Logs to Falcon." },
  { terms: ["log bucket"], kind: "gcp", meaning: "The Cloud Logging container that stores log entries." },
  { terms: ["exclusion"], kind: "gcp", meaning: "A filter that makes a sink or log bucket drop matching entries, so they are no longer exported or stored." },
  { terms: ["audit logs", "Cloud Audit Logs"], kind: "gcp", meaning: "GCP's record of who did what, on which resource, and when." },
  { terms: ["DATA_READ"], kind: "gcp", meaning: "The audit log type that records reads of data. Off by default for most services." },
  { terms: ["data-access logs"], kind: "gcp", meaning: "Audit logs that record who read or changed data." },
  { terms: ["VPC"], kind: "gcp", meaning: "Virtual Private Cloud: the private network your GCP resources run in." },
  { terms: ["ingress"], kind: "gcp", meaning: "Traffic coming into a network from outside." },
  { terms: ["load balancer"], kind: "gcp", meaning: "The managed front door that receives public traffic and forwards it to services." },
  { terms: ["owner"], kind: "gcp", meaning: "roles/owner: full control of a project, including who has access to it." },
  { terms: ["editor"], kind: "gcp", meaning: "roles/editor: can change most resources in a project." },
  { terms: ["security admin"], kind: "gcp", meaning: "roles/iam.securityAdmin: can read and change any IAM policy." },
  { terms: ["IAM policy"], kind: "gcp", meaning: "The list of which identities hold which roles on a resource." },
  { terms: ["principal"], kind: "gcp", meaning: "Any identity that can be granted access: a user, a group or a service account." },
  { terms: ["service account", "service accounts"], kind: "gcp", meaning: "A non-human identity used by workloads and automation." },
  { terms: ["service-account credentials"], kind: "gcp", meaning: "Keys or tokens that let someone act as a service account." },
  { terms: ["user-managed key", "SA keys"], kind: "gcp", meaning: "A long-lived private key for a service account. You store it and you must rotate it yourself." },
  { terms: ["Workload Identity"], kind: "gcp", meaning: "Keyless login: workloads receive short-lived tokens instead of using stored keys." },
  { terms: ["Secret Manager"], kind: "gcp", meaning: "GCP's encrypted store for API keys, passwords and certificates." },
  { terms: ["org policy"], kind: "gcp", meaning: "An organization-wide rule that blocks a risky setting, whatever a project's own permissions allow." },
  { terms: ["data-exfiltration"], kind: "security", meaning: "Data being copied out of the organization by an attacker or insider." },
  { terms: ["misconfiguration path", "misconfiguration"], kind: "security", meaning: "A way in created by a wrong setting, not by a software bug." },
  { terms: ["credential-theft"], kind: "security", meaning: "Stealing keys, passwords or tokens to log in as someone else." },
  { terms: ["persistence"], kind: "security", meaning: "Keeping access after the original way in is closed, for example after a password reset." },
  { terms: ["blind detection"], kind: "security", meaning: "Turning off the logs defenders rely on, so the attacker's next steps go unseen." },
  { terms: ["compromised account"], kind: "security", meaning: "An account an attacker controls, for example through phishing." },
  { terms: ["harvesting credentials"], kind: "security", meaning: "Collecting passwords and keys to gain further access." },
  { terms: ["data exposure"], kind: "security", meaning: "Data that people outside the organization may have been able to read." },
  { terms: ["just-in-time access"], kind: "security", meaning: "Privileges granted briefly when needed, instead of permanently." },
]

const LOOKUP = new Map<string, GlossaryEntry>(
  ENTRIES.flatMap(({ terms, kind, meaning }) => terms.map((t) => [t.toLowerCase(), { kind, meaning }] as const)),
)

// Longest first, so "misconfiguration path" wins over "misconfiguration".
const PATTERN = [...LOOKUP.keys()]
  .sort((a, b) => b.length - a.length)
  .map((t) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
  .join("|")

/** Splits text into plain strings and glossary matches. */
export function splitTerms(text: string): (string | { term: string; entry: GlossaryEntry })[] {
  const out: (string | { term: string; entry: GlossaryEntry })[] = []
  let last = 0
  for (const m of text.matchAll(new RegExp(`(?<![\\w/.-])(?:${PATTERN})(?![\\w-])`, "gi"))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push({ term: m[0], entry: LOOKUP.get(m[0].toLowerCase())! })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
