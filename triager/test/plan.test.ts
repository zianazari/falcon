import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.js";
import { plan } from "../src/plan.js";
import { finding, issue, triaged } from "./helpers.js";

const now = new Date("2026-10-29T00:00:00Z");
const cfg = defaultConfig;
const scanned = new Set(["acme/api"]);

describe("plan", () => {
  it("creates an issue for a new finding", () => {
    const t = triaged();
    expect(plan(scanned, [t.finding], [t], [], now, cfg)).toEqual([{ kind: "create", repo: "acme/api", triaged: t }]);
  });

  it("files into the central issueRepo when configured", () => {
    const t = triaged();
    const [a] = plan(scanned, [t.finding], [t], [], now, { ...cfg, issueRepo: "acme/security" });
    expect(a).toMatchObject({ kind: "create", repo: "acme/security" });
  });

  it("does not open issues below minIssuePriority", () => {
    const t = triaged({ priority: "P4" });
    expect(plan(scanned, [t.finding], [t], [], now, cfg)[0]?.kind).toBe("report-only");
  });

  it("is idempotent: an up-to-date issue needs nothing", () => {
    const t = triaged();
    expect(plan(scanned, [t.finding], [t], [issue()], now, cfg)[0]?.kind).toBe("ok");
  });

  it("updates the issue when priority changes", () => {
    const t = triaged({ priority: "P1" });
    expect(plan(scanned, [t.finding], [t], [issue()], now, cfg)[0]).toMatchObject({ kind: "update", from: "P2" });
  });

  it("nudges an overdue issue, then waits nudgeIntervalDays", () => {
    const t = triaged({ overdueDays: 3 });
    expect(plan(scanned, [t.finding], [t], [issue()], now, cfg)[0]?.kind).toBe("nudge");

    const recently = issue({ lastNudge: new Date("2026-10-25T00:00:00Z") });
    expect(plan(scanned, [t.finding], [t], [recently], now, cfg)[0]?.kind).toBe("ok");

    const longAgo = issue({ lastNudge: new Date("2026-10-20T00:00:00Z") });
    expect(plan(scanned, [t.finding], [t], [longAgo], now, cfg)[0]?.kind).toBe("nudge");
  });

  it("reopens an issue closed while the alert is still open", () => {
    const t = triaged();
    expect(plan(scanned, [t.finding], [t], [issue({ state: "closed" })], now, cfg)[0]?.kind).toBe("reopen");
  });

  it("closes the issue when the alert is fixed or gone", () => {
    const fixed = finding({ state: "fixed" });
    expect(plan(scanned, [fixed], [], [issue()], now, cfg)).toEqual([
      { kind: "close", issue: issue(), reason: "alert is fixed" },
    ]);
    expect(plan(scanned, [], [], [issue()], now, cfg)[0]).toMatchObject({ reason: "alert no longer exists" });
  });

  it("never closes issues for repos it did not scan", () => {
    const other = issue({ findingKey: "acme/other:dependabot:1" });
    expect(plan(scanned, [], [], [other], now, cfg)).toEqual([]);
  });
});
