import type { Config } from "./config.js";
import type { Finding, Intel, Priority } from "./types.js";

/** Used when an advisory has no CVSS score. */
const SEVERITY_CVSS = { critical: 9.5, high: 8.0, medium: 5.5, low: 3.0 } as const;

export interface Score {
  score: number;
  priority: Priority;
  reasons: string[];
}

/**
 * A transparent 0-100 points model. Every point is explained in `reasons`, so
 * an engineer can see why their alert is P1:
 *
 *   impact       CVSS x 4                          up to 40
 *   likelihood   EPSS probability x 30             up to 30
 *   exploited    listed in CISA KEV                +30
 *   reachable    first-party code (code scanning)  +15
 *   dev-only     development dependency or test    x 0.5
 *
 * Runtime findings in KEV are always P1: exploitation is happening now.
 */
export function score(f: Finding, intel: Intel, cfg: Config): Score {
  const reasons: string[] = [];
  const cvss = f.cvss ?? SEVERITY_CVSS[f.severity];
  let points = cvss * 4;
  reasons.push(f.cvss ? `CVSS ${cvss.toFixed(1)} (+${(cvss * 4).toFixed(0)})` : `${f.severity} severity, no CVSS (+${(cvss * 4).toFixed(0)})`);

  const epss = f.cve ? intel.epss(f.cve) : undefined;
  if (epss) {
    points += epss.score * 30;
    reasons.push(`EPSS ${(epss.score * 100).toFixed(1)}%, ${ordinal(Math.floor(epss.percentile * 100))} percentile (+${(epss.score * 30).toFixed(0)})`);
  }

  const kev = f.cve ? intel.inKev(f.cve) : false;
  if (kev) {
    points += 30;
    reasons.push("in CISA Known Exploited Vulnerabilities (+30)");
  }

  if (f.source === "code-scanning") {
    points += 15;
    reasons.push("first-party code, reachable by definition (+15)");
  }

  if (f.scope === "development") {
    points *= 0.5;
    reasons.push("development-only (x0.5)");
  }

  const total = Math.round(Math.min(100, points));
  let priority: Priority;
  if (kev && f.scope !== "development") priority = "P1";
  else if (total >= cfg.thresholds.P1) priority = "P1";
  else if (total >= cfg.thresholds.P2) priority = "P2";
  else if (total >= cfg.thresholds.P3) priority = "P3";
  else priority = "P4";

  return { score: total, priority, reasons };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

export function dueDate(f: Finding, priority: Priority, cfg: Config): Date {
  const created = new Date(f.createdAt);
  return new Date(created.getTime() + cfg.slaDays[priority] * 86_400_000);
}
