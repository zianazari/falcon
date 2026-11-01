import type { Finding, TrackedIssue, Triaged } from "../src/types.js";

export function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    key: "acme/api:dependabot:1",
    repo: "acme/api",
    source: "dependabot",
    number: 1,
    state: "open",
    ecosystem: "npm",
    package: "left-pad",
    path: "package-lock.json",
    title: "Something bad",
    cve: "CVE-2099-0001",
    severity: "high",
    cvss: 7.5,
    scope: "runtime",
    url: "https://github.com/acme/api/security/dependabot/1",
    createdAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

export function triaged(overrides: Partial<Triaged> = {}, f: Partial<Finding> = {}): Triaged {
  return {
    finding: finding(f),
    score: 50,
    priority: "P2",
    reasons: ["test"],
    owners: ["@acme/team"],
    dueAt: new Date("2026-10-31T00:00:00Z"),
    overdueDays: 0,
    ...overrides,
  };
}

export function issue(overrides: Partial<TrackedIssue> = {}): TrackedIssue {
  return {
    repo: "acme/api",
    number: 10,
    state: "open",
    title: "[P2] left-pad",
    labels: ["falcon", "falcon:P2"],
    findingKey: "acme/api:dependabot:1",
    ...overrides,
  };
}
