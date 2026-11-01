// The subset of GitHub REST API response shapes the triager reads.

export interface DependabotAlert {
  number: number;
  state: "open" | "fixed" | "dismissed" | "auto_dismissed";
  dependency: {
    package: { ecosystem: string; name: string };
    manifest_path: string;
    scope: "runtime" | "development" | null;
  };
  security_advisory: {
    ghsa_id: string;
    cve_id: string | null;
    summary: string;
    severity: string;
    cvss?: { score: number | null; vector_string?: string | null } | null;
  };
  security_vulnerability: {
    first_patched_version: { identifier: string } | null;
  };
  html_url: string;
  created_at: string;
}

export interface CodeScanningAlert {
  number: number;
  state: "open" | "fixed" | "dismissed";
  rule: {
    id: string;
    description: string;
    severity?: string | null;
    security_severity_level?: "critical" | "high" | "medium" | "low" | null;
  };
  tool: { name: string };
  most_recent_instance: { location?: { path?: string } };
  html_url: string;
  created_at: string;
}

export interface Issue {
  number: number;
  state: "open" | "closed";
  title: string;
  body?: string | null;
  labels: Array<string | { name?: string }>;
  pull_request?: unknown;
}
