import type { Action } from "./plan.js";
import type { Triaged } from "./types.js";

const day = (d: Date) => d.toISOString().slice(0, 10);

function actionFor(t: Triaged, actions: Action[]): string {
  for (const a of actions) {
    if (a.kind === "close" || !("triaged" in a) || a.triaged !== t) continue;
    switch (a.kind) {
      case "create": return `create issue in ${a.repo}`;
      case "update": return `update #${a.issue.number} (${a.from} -> ${t.priority})`;
      case "nudge": return `nudge #${a.issue.number}`;
      case "reopen": return `reopen #${a.issue.number}`;
      case "ok": return `tracked in #${a.issue.number}`;
      case "report-only": return "report only (below issue threshold)";
    }
  }
  return "";
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd()).join("\n");
}

export function textReport(triaged: Triaged[], actions: Action[]): string {
  const rows = [["PRI", "SCORE", "REPO", "ALERT", "PACKAGE", "CVE", "OWNERS", "DUE", "ACTION"]];
  for (const t of triaged) {
    const f = t.finding;
    rows.push([
      t.priority,
      String(t.score),
      f.repo,
      `${f.source === "dependabot" ? "dep" : "code"}#${f.number}`,
      `${f.package} (${f.ecosystem})`,
      f.cve ?? "-",
      t.owners.join(" "),
      t.overdueDays > 0 ? `${day(t.dueAt)} (${t.overdueDays}d late)` : day(t.dueAt),
      actionFor(t, actions),
    ]);
  }

  const out = [table(rows), ""];
  for (const a of actions) {
    if (a.kind === "close") out.push(`close ${a.issue.repo}#${a.issue.number}: ${a.reason}`);
  }

  out.push("", "Why (top findings):");
  for (const t of triaged.slice(0, 3)) {
    out.push(`  ${t.priority} ${t.finding.package} (${t.score}): ${t.reasons.join("; ")}`);
  }

  const counts = new Map<string, number>();
  for (const a of actions) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  out.push("", `Plan: ${[...counts].map(([k, n]) => `${n} ${k}`).join(", ")}`);
  return out.join("\n");
}

export function jsonReport(triaged: Triaged[], actions: Action[]): string {
  return JSON.stringify({
    findings: triaged.map((t) => ({
      key: t.finding.key,
      repo: t.finding.repo,
      source: t.finding.source,
      number: t.finding.number,
      title: t.finding.title,
      severity: t.finding.severity,
      path: t.finding.path,
      priority: t.priority,
      score: t.score,
      reasons: t.reasons,
      owners: t.owners,
      due: day(t.dueAt),
      overdueDays: t.overdueDays,
      package: t.finding.package,
      ecosystem: t.finding.ecosystem,
      cve: t.finding.cve ?? null,
      url: t.finding.url,
    })),
    actions: actions.map((a) => ({
      kind: a.kind,
      key: "triaged" in a ? a.triaged.finding.key : a.issue.findingKey,
      issue: "issue" in a ? `${a.issue.repo}#${a.issue.number}` : null,
      repo: "repo" in a ? a.repo : null,
      from: "from" in a ? a.from : null,
      reason: "reason" in a ? a.reason : null,
    })),
  }, null, 2);
}
