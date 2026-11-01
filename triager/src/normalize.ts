import type { CodeScanningAlert, DependabotAlert } from "./github/types.js";
import type { Finding, Severity } from "./types.js";

const ECOSYSTEMS: Record<string, string> = { pip: "pip", npm: "npm", maven: "maven", go: "go", gomod: "go" };

function severity(s: string | null | undefined): Severity {
  const v = (s ?? "").toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  if (v === "moderate") return "medium";
  if (v === "error") return "high";
  if (v === "warning") return "medium";
  return "low";
}

function state(s: string): Finding["state"] {
  if (s === "open") return "open";
  if (s === "fixed") return "fixed";
  return "dismissed";
}

export function fromDependabot(repo: string, a: DependabotAlert): Finding {
  const ecosystem = ECOSYSTEMS[a.dependency.package.ecosystem] ?? a.dependency.package.ecosystem;
  const cvss = a.security_advisory.cvss?.score;
  return {
    key: `${repo}:dependabot:${a.number}`,
    repo,
    source: "dependabot",
    number: a.number,
    state: state(a.state),
    ecosystem,
    package: a.dependency.package.name,
    path: a.dependency.manifest_path,
    title: a.security_advisory.summary,
    cve: a.security_advisory.cve_id ?? undefined,
    ghsa: a.security_advisory.ghsa_id,
    severity: severity(a.security_advisory.severity),
    // GitHub reports 0 when an advisory has no CVSS score.
    cvss: cvss ? cvss : undefined,
    scope: a.dependency.scope ?? "unknown",
    fixedIn: a.security_vulnerability.first_patched_version?.identifier,
    url: a.html_url,
    createdAt: a.created_at,
  };
}

export function fromCodeScanning(repo: string, a: CodeScanningAlert): Finding {
  return {
    key: `${repo}:code-scanning:${a.number}`,
    repo,
    source: "code-scanning",
    number: a.number,
    state: state(a.state),
    ecosystem: "code",
    package: a.rule.id,
    path: a.most_recent_instance.location?.path ?? "",
    title: `${a.rule.description} (${a.tool.name})`,
    severity: severity(a.rule.security_severity_level ?? a.rule.severity),
    // First-party code runs in production unless it is a test.
    scope: /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[jt]sx?$/.test(a.most_recent_instance.location?.path ?? "")
      ? "development"
      : "runtime",
    url: a.html_url,
    createdAt: a.created_at,
  };
}
