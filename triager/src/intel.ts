import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Epss, Intel } from "./types.js";

const EPSS_API = "https://api.first.org/data/v1/epss";
const KEV_FEED = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

class MapIntel implements Intel {
  constructor(
    private readonly epssScores: Map<string, Epss>,
    private readonly kev: Set<string>,
  ) {}
  epss(cve: string): Epss | undefined {
    return this.epssScores.get(cve);
  }
  inKev(cve: string): boolean {
    return this.kev.has(cve);
  }
}

/** Fetches EPSS scores for the given CVEs and the full CISA KEV catalog. */
export async function liveIntel(cves: string[], fetchFn: typeof fetch = fetch): Promise<Intel> {
  const epss = new Map<string, Epss>();
  const unique = [...new Set(cves)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const res = await fetchFn(`${EPSS_API}?cve=${batch.join(",")}`);
    if (!res.ok) throw new Error(`EPSS API: HTTP ${res.status}`);
    const body = (await res.json()) as { data: Array<{ cve: string; epss: string; percentile: string }> };
    for (const d of body.data) epss.set(d.cve, { score: Number(d.epss), percentile: Number(d.percentile) });
  }

  const res = await fetchFn(KEV_FEED);
  if (!res.ok) throw new Error(`CISA KEV feed: HTTP ${res.status}`);
  const kev = (await res.json()) as { vulnerabilities: Array<{ cveID: string }> };
  return new MapIntel(epss, new Set(kev.vulnerabilities.map((v) => v.cveID)));
}

/** Reads <dir>/intel/epss.json ({cve: {score, percentile}}) and <dir>/intel/kev.json ([cve]). */
export async function fixtureIntel(dir: string): Promise<Intel> {
  const epss = JSON.parse(await readFile(join(dir, "intel", "epss.json"), "utf8")) as Record<string, Epss>;
  const kev = JSON.parse(await readFile(join(dir, "intel", "kev.json"), "utf8")) as string[];
  return new MapIntel(new Map(Object.entries(epss)), new Set(kev));
}

export function staticIntel(epss: Record<string, Epss> = {}, kev: string[] = []): Intel {
  return new MapIntel(new Map(Object.entries(epss)), new Set(kev));
}
