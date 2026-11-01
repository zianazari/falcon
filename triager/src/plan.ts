import type { Config } from "./config.js";
import { priorityLabel } from "./issues.js";
import { PRIORITIES, type Finding, type TrackedIssue, type Triaged } from "./types.js";

export type Action =
  | { kind: "create"; repo: string; triaged: Triaged }
  | { kind: "update"; issue: TrackedIssue; triaged: Triaged; from: string }
  | { kind: "nudge"; issue: TrackedIssue; triaged: Triaged }
  | { kind: "reopen"; issue: TrackedIssue; triaged: Triaged }
  | { kind: "close"; issue: TrackedIssue; reason: string }
  | { kind: "report-only"; triaged: Triaged }
  | { kind: "ok"; issue: TrackedIssue; triaged: Triaged };

const rank = (p: string) => PRIORITIES.indexOf(p as (typeof PRIORITIES)[number]);

/**
 * Decides what to do for every finding, given the issues that already exist.
 * Pure function: no I/O, so every branch is unit-tested.
 *
 * @param scanned   repos whose alerts were fetched. Issues for other repos (in a
 *                  shared issueRepo) are left alone, never closed by mistake.
 * @param findings  all alerts, any state. Needed to close issues for fixed alerts.
 * @param triaged   the open findings, scored.
 */
export function plan(
  scanned: Set<string>,
  findings: Finding[],
  triaged: Triaged[],
  issues: TrackedIssue[],
  now: Date,
  cfg: Config,
): Action[] {
  const byKey = new Map(issues.map((i) => [i.findingKey, i]));
  const openKeys = new Set(triaged.map((t) => t.finding.key));
  const actions: Action[] = [];

  for (const t of triaged) {
    const issue = byKey.get(t.finding.key);
    if (!issue) {
      actions.push(rank(t.priority) <= rank(cfg.minIssuePriority)
        ? { kind: "create", repo: cfg.issueRepo ?? t.finding.repo, triaged: t }
        : { kind: "report-only", triaged: t });
      continue;
    }
    if (issue.state === "closed") {
      // Closing the issue does not fix the vulnerability.
      actions.push({ kind: "reopen", issue, triaged: t });
      continue;
    }
    const current = issue.labels.find((l) => l.startsWith("falcon:P"));
    if (current !== priorityLabel(t.priority)) {
      actions.push({ kind: "update", issue, triaged: t, from: current?.slice("falcon:".length) ?? "none" });
      continue;
    }
    const sinceNudge = issue.lastNudge ? (now.getTime() - issue.lastNudge.getTime()) / 86_400_000 : Infinity;
    if (t.overdueDays > 0 && sinceNudge >= cfg.nudgeIntervalDays) {
      actions.push({ kind: "nudge", issue, triaged: t });
      continue;
    }
    actions.push({ kind: "ok", issue, triaged: t });
  }

  const states = new Map(findings.map((f) => [f.key, f.state]));
  for (const issue of issues) {
    if (issue.state !== "open" || openKeys.has(issue.findingKey)) continue;
    const repo = issue.findingKey.split(":")[0] ?? "";
    if (!scanned.has(repo)) continue;
    const st = states.get(issue.findingKey);
    actions.push({ kind: "close", issue, reason: st ? `alert is ${st}` : "alert no longer exists" });
  }
  return actions;
}
