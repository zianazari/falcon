import { describe, expect, it } from "vitest";
import { apply } from "../src/apply.js";
import { defaultConfig } from "../src/config.js";
import { FixturePlatform } from "../src/github/fixtures.js";
import type { IssueDraft, IssuePatch, Platform } from "../src/github/platform.js";
import { fixtureIntel } from "../src/intel.js";
import { issueBody, parseIssues } from "../src/issues.js";
import { triage } from "../src/triage.js";
import { triaged } from "./helpers.js";

const DEMO = new URL("./fixtures/demo", import.meta.url).pathname;
const NOW = new Date("2026-10-29T09:00:00Z");
const REPOS = ["acme/payments-api", "acme/data-platform"];

describe("triage on the demo fixtures", async () => {
  const result = await triage(new FixturePlatform(DEMO), REPOS, await fixtureIntel(DEMO), NOW, defaultConfig);
  const byPkg = new Map(result.triaged.map((t) => [t.finding.package, t]));

  it("only triages open alerts, highest score first", () => {
    expect(result.triaged.map((t) => t.finding.package)).toEqual([
      "org.apache.logging.log4j:log4j-core",
      "golang.org/x/net",
      "js/sql-injection",
      "lodash",
      "jinja2",
      "braces",
    ]);
  });

  it("assigns priorities and owners", () => {
    expect(byPkg.get("org.apache.logging.log4j:log4j-core")).toMatchObject({
      priority: "P1", owners: ["@acme/ledger-team", "@alice"], overdueDays: 7,
    });
    expect(byPkg.get("golang.org/x/net")).toMatchObject({ priority: "P1", owners: ["@acme/ingest-team"] });
    expect(byPkg.get("js/sql-injection")).toMatchObject({ priority: "P2", owners: ["@acme/checkout-team"] });
    expect(byPkg.get("braces")).toMatchObject({ priority: "P4", owners: ["@acme/platform"] });
  });

  it("plans every issue lifecycle action", () => {
    const summary = result.actions.map((a) =>
      a.kind === "close" ? `close #${a.issue.number}` : `${a.kind} ${a.triaged.finding.package}`);
    expect(summary).toEqual([
      "create org.apache.logging.log4j:log4j-core",
      "nudge golang.org/x/net",
      "create js/sql-injection",
      "update lodash",
      "create jinja2",
      "report-only braces",
      "close #101",
    ]);
  });
});

class RecordingPlatform implements Platform {
  calls: string[] = [];
  dependabotAlerts = async () => [];
  codeScanningAlerts = async () => [];
  codeowners = async () => null;
  falconIssues = async () => [];
  async createIssue(repo: string, d: IssueDraft) {
    this.calls.push(`create ${repo} ${d.title} [${d.labels.join(",")}]`);
    return 1;
  }
  async updateIssue(repo: string, n: number, p: IssuePatch) {
    this.calls.push(`update ${repo}#${n} ${Object.keys(p).join(",")}`);
  }
  async comment(repo: string, n: number, body: string) {
    this.calls.push(`comment ${repo}#${n} ${body.slice(0, 20)}`);
  }
}

describe("apply", () => {
  it("records the nudge time in the body so the next run can see it", async () => {
    const p = new RecordingPlatform();
    const t = triaged({ overdueDays: 4 });
    await apply(p, [{ kind: "nudge", issue: parseIssues("acme/api", [{
      number: 5, state: "open", title: "x", labels: ["falcon", "falcon:P2"], body: issueBody(t),
    }])[0]!, triaged: t }], NOW, () => {});
    expect(p.calls).toEqual(["comment acme/api#5 @acme/team this P2 i", "update acme/api#5 body"]);
  });

  it("created issues round-trip through the body markers", () => {
    const t = triaged();
    const [parsed] = parseIssues("acme/api", [{ number: 1, state: "open", title: "t", labels: [], body: issueBody(t, NOW) }]);
    expect(parsed).toMatchObject({ findingKey: t.finding.key, lastNudge: NOW });
  });
});
