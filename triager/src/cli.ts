#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { apply } from "./apply.js";
import { loadConfig } from "./config.js";
import { FixturePlatform } from "./github/fixtures.js";
import { GitHubPlatform, type Platform } from "./github/platform.js";
import { fixtureIntel, liveIntel } from "./intel.js";
import { jsonReport, textReport } from "./report.js";
import { triage } from "./triage.js";
import { PRIORITIES, type Intel, type Priority } from "./types.js";

const USAGE = `falcon-triage <command> --repo owner/name [--repo ...] [options]

Commands:
  run     score alerts, route them to owners, sync GitHub issues, nudge overdue ones
  check   exit 1 if any open finding at --max-priority or higher is past its SLA (CI gate)

Options:
  --fixtures DIR        use recorded API responses and intel instead of GitHub (implies --dry-run)
  --dry-run             read from GitHub but do not create, update or comment on issues
  --json                machine-readable output
  --now ISO-DATE        evaluate SLAs as of this time (default: now, or fixtures' meta.json)
  --config FILE         JSON overrides for SLAs, thresholds, owners, issueRepo
  --max-priority P1-P4  check: lowest priority that fails the gate (default from config: P2)

Environment:
  GITHUB_TOKEN          needs Dependabot alerts, code scanning alerts, contents: read; issues: write`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: "string", multiple: true, default: [] },
      fixtures: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      now: { type: "string" },
      config: { type: "string" },
      "max-priority": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = positionals[0];
  if (values.help || !command || !["run", "check"].includes(command) || values.repo.length === 0) {
    console.error(USAGE);
    return 2;
  }

  const cfg = await loadConfig(values.config);
  let platform: Platform;
  let intel: Intel | ((cves: string[]) => Promise<Intel>);
  let now = values.now ? new Date(values.now) : new Date();
  let dryRun = values["dry-run"];

  if (values.fixtures) {
    platform = new FixturePlatform(values.fixtures);
    intel = await fixtureIntel(values.fixtures);
    dryRun = true;
    if (!values.now) now = await fixtureNow(values.fixtures, now);
  } else {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.error("GITHUB_TOKEN is required (or use --fixtures)");
      return 2;
    }
    platform = new GitHubPlatform(token);
    intel = (cves) => liveIntel(cves);
  }

  const result = await triage(platform, values.repo, intel, now, cfg);
  const log = (s: string) => console.error(s);

  if (command === "check") {
    const maxPriority = (values["max-priority"] ?? cfg.gatePriority) as Priority;
    if (!PRIORITIES.includes(maxPriority)) throw new Error(`--max-priority must be one of ${PRIORITIES.join(", ")}`);
    const breaches = result.triaged.filter(
      (t) => t.overdueDays > 0 && PRIORITIES.indexOf(t.priority) <= PRIORITIES.indexOf(maxPriority),
    );
    if (values.json) {
      console.log(jsonReport(breaches, []));
    } else if (breaches.length === 0) {
      console.log(`PASS: no ${maxPriority}-or-higher findings past their SLA`);
    } else {
      console.log(`FAIL: ${breaches.length} finding(s) at ${maxPriority} or higher are past their SLA:`);
      for (const t of breaches) {
        console.log(`  ${t.priority} ${t.finding.repo} ${t.finding.package} ${t.finding.cve ?? ""} ` +
          `${t.overdueDays}d overdue, owners ${t.owners.join(" ")}\n     ${t.finding.url}`);
      }
    }
    return breaches.length === 0 ? 0 : 1;
  }

  console.log(values.json ? jsonReport(result.triaged, result.actions) : textReport(result.triaged, result.actions));
  if (dryRun) {
    if (!values.json) console.log("\nDry run: no issues were changed.");
  } else {
    await apply(platform, result.actions, now, log);
  }
  return 0;
}

async function fixtureNow(dir: string, fallback: Date): Promise<Date> {
  try {
    const meta = JSON.parse(await readFile(`${dir}/meta.json`, "utf8")) as { now?: string };
    return meta.now ? new Date(meta.now) : fallback;
  } catch {
    return fallback;
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
