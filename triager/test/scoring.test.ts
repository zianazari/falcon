import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.js";
import { staticIntel } from "../src/intel.js";
import { dueDate, score } from "../src/scoring.js";
import { finding } from "./helpers.js";

const cfg = defaultConfig;

describe("score", () => {
  it("KEV + high EPSS + critical CVSS is P1", () => {
    const intel = staticIntel({ "CVE-2099-0001": { score: 0.9, percentile: 0.99 } }, ["CVE-2099-0001"]);
    const s = score(finding({ cvss: 10 }), intel, cfg);
    expect(s.score).toBe(97); // 40 + 27 + 30
    expect(s.priority).toBe("P1");
    expect(s.reasons.join(" ")).toContain("CISA Known Exploited");
  });

  it("KEV forces P1 for runtime even with a modest score", () => {
    const s = score(finding({ cvss: 4 }), staticIntel({}, ["CVE-2099-0001"]), cfg);
    expect(s.score).toBe(46);
    expect(s.priority).toBe("P1");
  });

  it("KEV does not force P1 for a development dependency", () => {
    const s = score(finding({ cvss: 4, scope: "development" }), staticIntel({}, ["CVE-2099-0001"]), cfg);
    expect(s.score).toBe(23);
    expect(s.priority).toBe("P3");
  });

  it("high CVSS with negligible EPSS is not urgent", () => {
    const s = score(finding({ cvss: 7.5 }), staticIntel({ "CVE-2099-0001": { score: 0.001, percentile: 0.3 } }), cfg);
    expect(s.priority).toBe("P3");
  });

  it("falls back to severity when CVSS is missing", () => {
    const s = score(finding({ cvss: undefined, severity: "critical", cve: undefined }), staticIntel(), cfg);
    expect(s.score).toBe(38);
    expect(s.reasons[0]).toMatch(/no CVSS/);
  });

  it("first-party code-scanning findings get a reachability bonus", () => {
    const s = score(finding({ source: "code-scanning", cvss: undefined, cve: undefined, severity: "high" }), staticIntel(), cfg);
    expect(s.score).toBe(47);
    expect(s.priority).toBe("P2");
  });

  it("due date is created + SLA for the priority", () => {
    expect(dueDate(finding(), "P1", cfg).toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(dueDate(finding(), "P3", cfg).toISOString()).toBe("2026-12-30T00:00:00.000Z");
  });
});
