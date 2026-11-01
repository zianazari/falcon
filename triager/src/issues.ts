import { FALCON_LABEL } from "./github/platform.js";
import type { Issue } from "./github/types.js";
import type { Priority, TrackedIssue, Triaged } from "./types.js";

// Hidden markers in the issue body make issues the source of truth: no
// database, and a re-run is idempotent.
const KEY_MARKER = /<!-- falcon:key=(\S+) -->/;
const NUDGE_MARKER = /<!-- falcon:last-nudge=(\S+) -->/;

export const priorityLabel = (p: Priority) => `falcon:${p}`;

export function issueLabels(t: Triaged): string[] {
  return [FALCON_LABEL, priorityLabel(t.priority), `ecosystem:${t.finding.ecosystem}`];
}

export function issueTitle(t: Triaged): string {
  const f = t.finding;
  const id = f.cve ?? f.ghsa;
  return `[${t.priority}] ${f.package}: ${f.title}${id ? ` (${id})` : ""}`;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function issueBody(t: Triaged, lastNudge?: Date): string {
  const f = t.finding;
  const rows: Array<[string, string]> = [
    ["Priority", `**${t.priority}** (score ${t.score}/100)`],
    ["Due", `${day(t.dueAt)}${t.overdueDays > 0 ? ` (**${t.overdueDays} days overdue**)` : ""}`],
    ["Owners", t.owners.join(" ")],
    ["Source", `[${f.source} alert #${f.number}](${f.url})`],
    ["Package", `\`${f.package}\` (${f.ecosystem}, ${f.scope})`],
    ["Location", `\`${f.path}\``],
  ];
  if (f.cve) rows.push(["CVE", f.cve]);
  if (f.fixedIn) rows.push(["Fix", `upgrade to \`${f.fixedIn}\` or later`]);

  return [
    `Falcon found a **${f.severity}** vulnerability that needs an owner.`,
    "",
    "| | |",
    "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "**Why this priority**",
    ...t.reasons.map((r) => `- ${r}`),
    "",
    "Fix it, or dismiss the alert with a reason. Falcon closes this issue when the alert is resolved.",
    "",
    `<!-- falcon:key=${f.key} -->`,
    ...(lastNudge ? [`<!-- falcon:last-nudge=${lastNudge.toISOString()} -->`] : []),
  ].join("\n");
}

export function nudgeComment(t: Triaged): string {
  return `${t.owners.join(" ")} this ${t.priority} is **${t.overdueDays} days past** its SLA (due ${day(t.dueAt)}). ` +
    `Please fix it, or dismiss the alert with a justification. ${t.finding.url}`;
}

/** Turns raw issues into tracked ones. Issues without a Falcon key are ignored. */
export function parseIssues(repo: string, issues: Issue[]): TrackedIssue[] {
  const out: TrackedIssue[] = [];
  for (const i of issues) {
    const key = i.body?.match(KEY_MARKER)?.[1];
    if (!key) continue;
    const nudge = i.body?.match(NUDGE_MARKER)?.[1];
    out.push({
      repo,
      number: i.number,
      state: i.state,
      title: i.title,
      labels: i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
      findingKey: key,
      lastNudge: nudge ? new Date(nudge) : undefined,
    });
  }
  return out;
}
