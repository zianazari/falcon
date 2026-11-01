import type { Config } from "./config.js";
import type { Platform } from "./github/platform.js";
import { parseIssues } from "./issues.js";
import { fromCodeScanning, fromDependabot } from "./normalize.js";
import { ownersFor, parseCodeowners } from "./owners.js";
import { plan, type Action } from "./plan.js";
import { dueDate, score } from "./scoring.js";
import type { Finding, Intel, Triaged } from "./types.js";

export interface TriageResult {
  findings: Finding[];
  triaged: Triaged[];
  actions: Action[];
}

/** Collects every alert for the repos. */
export async function collect(platform: Platform, repos: string[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const repo of repos) {
    const [deps, code] = await Promise.all([platform.dependabotAlerts(repo), platform.codeScanningAlerts(repo)]);
    findings.push(...deps.map((a) => fromDependabot(repo, a)), ...code.map((a) => fromCodeScanning(repo, a)));
  }
  return findings;
}

/** Fetches, scores, assigns owners and plans issue actions. Makes no writes. */
export async function triage(
  platform: Platform,
  repos: string[],
  intel: Intel | ((cves: string[]) => Promise<Intel>),
  now: Date,
  cfg: Config,
): Promise<TriageResult> {
  const findings = await collect(platform, repos);
  const open = findings.filter((f) => f.state === "open");
  const resolvedIntel =
    typeof intel === "function" ? await intel(open.flatMap((f) => (f.cve ? [f.cve] : []))) : intel;

  const owners = new Map<string, ReturnType<typeof parseCodeowners>>();
  for (const repo of repos) owners.set(repo, parseCodeowners((await platform.codeowners(repo)) ?? ""));

  const triaged: Triaged[] = open.map((f) => {
    const s = score(f, resolvedIntel, cfg);
    const dueAt = dueDate(f, s.priority, cfg);
    return {
      finding: f,
      ...s,
      owners: ownersFor(owners.get(f.repo) ?? [], f.path) ?? cfg.defaultOwners,
      dueAt,
      overdueDays: Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / 86_400_000)),
    };
  });
  triaged.sort((a, b) => b.score - a.score || a.dueAt.getTime() - b.dueAt.getTime());

  const issueRepos = cfg.issueRepo ? [cfg.issueRepo] : repos;
  const issues = (
    await Promise.all(issueRepos.map(async (r) => parseIssues(r, await platform.falconIssues(r))))
  ).flat();

  return { findings, triaged, actions: plan(new Set(repos), findings, triaged, issues, now, cfg) };
}
