export type Priority = "P1" | "P2" | "P3" | "P4";
export const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];

export type Severity = "critical" | "high" | "medium" | "low";

/** One vulnerability alert, normalized across Dependabot and code scanning. */
export interface Finding {
  /** Stable identity, e.g. "acme/api:dependabot:12". */
  key: string;
  repo: string;
  source: "dependabot" | "code-scanning";
  number: number;
  state: "open" | "fixed" | "dismissed";
  /** npm, maven, go, pip, or "code" for first-party code-scanning results. */
  ecosystem: string;
  /** Package name, or the code-scanning rule id. */
  package: string;
  /** Manifest path (Dependabot) or file path (code scanning); used for ownership. */
  path: string;
  title: string;
  cve?: string;
  ghsa?: string;
  severity: Severity;
  cvss?: number;
  scope: "runtime" | "development" | "unknown";
  fixedIn?: string;
  url: string;
  createdAt: string;
}

export interface Epss {
  score: number;
  percentile: number;
}

/** Threat intelligence used for prioritization. */
export interface Intel {
  epss(cve: string): Epss | undefined;
  inKev(cve: string): boolean;
}

/** A finding after scoring and ownership. */
export interface Triaged {
  finding: Finding;
  score: number;
  priority: Priority;
  reasons: string[];
  owners: string[];
  dueAt: Date;
  overdueDays: number;
}

/** A Falcon-managed issue found in a repo. */
export interface TrackedIssue {
  repo: string;
  number: number;
  state: "open" | "closed";
  title: string;
  labels: string[];
  findingKey: string;
  lastNudge?: Date;
}
