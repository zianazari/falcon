// Falcon console API. Reads what the rest of the repo produces and serves it as JSON:
//   FALCON_SOURCE=local (default)  .data/*.jsonl from `make up && make attack`, docker compose, /stats
//   FALCON_SOURCE=gcp              BigQuery, Cloud Run, Logging and Pub/Sub in the deployed project
// Detections, runbooks and the triage plan always come from the repo itself.
// Runs directly with Node's type stripping: node server/index.ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.resolve(import.meta.dirname, "../dist");
const PORT = Number(process.env.PORT ?? 8090);
const SOURCE = process.env.FALCON_SOURCE === "gcp" ? "gcp" : "local";
const LIMIT = 2000;

type Json = Record<string, unknown>;

// ---------------------------------------------------------------- helpers

async function run(cmd: string, args: string[], cwd = ROOT, timeout = 120_000) {
  try {
    const { stdout, stderr } = await exec(cmd, args, { cwd, timeout, maxBuffer: 64 << 20 });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, stdout: e.stdout ?? "", stderr: e.stderr || e.message };
  }
}

async function readJsonl(file: string): Promise<Json[]> {
  if (!existsSync(file)) return [];
  const out: Json[] = [];
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A half-written last line while the pipeline is appending: skip it.
    }
  }
  return out;
}

const newestFirst = (field: string) => (a: Json, b: Json) => String(b[field]).localeCompare(String(a[field]));

// ---------------------------------------------------------------- GCP access

let token: { value: string; expires: number } | undefined;

async function gcpToken(): Promise<string> {
  if (token && token.expires > Date.now()) return token.value;
  const r = await run("gcloud", ["auth", "print-access-token"]);
  if (!r.ok) throw new Error("gcloud auth print-access-token failed; run `gcloud auth login`");
  token = { value: r.stdout.trim(), expires: Date.now() + 10 * 60_000 };
  return token.value;
}

async function gcp(url: string, init: RequestInit = {}): Promise<Json> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await gcpToken()}`, "Content-Type": "application/json" },
  });
  const body = (await res.json()) as Json;
  if (!res.ok) throw new Error(`${res.status} ${url}: ${JSON.stringify(body.error ?? body)}`);
  return body;
}

let tfCache: Record<string, unknown> | undefined;

async function terraformOutputs(): Promise<Record<string, unknown>> {
  if (tfCache) return tfCache;
  const r = await run("terraform", ["-chdir=infra/terraform/envs/dev", "output", "-json"]);
  if (!r.ok) return {};
  const raw = JSON.parse(r.stdout || "{}") as Record<string, { value: unknown }>;
  tfCache = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.value]));
  return tfCache;
}

async function gcpConfig() {
  const tf = await terraformOutputs();
  const vars = (tf.github_actions_variables ?? {}) as Record<string, string>;
  const project = process.env.GCP_PROJECT ?? vars.GCP_PROJECT_ID;
  if (!project) throw new Error("set GCP_PROJECT, or run terraform apply in infra/terraform/envs/dev");
  return {
    project,
    region: process.env.GCP_REGION ?? vars.GCP_REGION ?? "europe-north1",
    dataset: (tf.bigquery_dataset as string) ?? "falcon_security",
    service: vars.GCP_PIPELINE_SERVICE ?? "falcon-pipeline",
  };
}

// Each row comes back as one JSON string, which avoids BigQuery's f/v row format.
async function bq(sql: string): Promise<Json[]> {
  const { project } = await gcpConfig();
  const res = await gcp(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
    method: "POST",
    body: JSON.stringify({ query: `SELECT TO_JSON_STRING(t) AS j FROM (${sql}) t`, useLegacySql: false, timeoutMs: 30_000 }),
  });
  const rows = (res.rows ?? []) as { f: { v: string }[] }[];
  return rows.map((r) => JSON.parse(r.f[0]!.v) as Json);
}

// ---------------------------------------------------------------- data

async function events(): Promise<Json[]> {
  if (SOURCE === "local") return (await readJsonl(path.join(ROOT, ".data/events.jsonl"))).sort(newestFirst("ts")).slice(0, LIMIT);
  const { dataset } = await gcpConfig();
  const rows = await bq(`SELECT * FROM ${dataset}.events ORDER BY ts DESC LIMIT ${LIMIT}`);
  // raw is stored as a JSON string column.
  return rows.map((r) => ({ ...r, raw: typeof r.raw === "string" ? safeJson(r.raw) : r.raw }));
}

async function alerts(): Promise<Json[]> {
  if (SOURCE === "local") return (await readJsonl(path.join(ROOT, ".data/alerts.jsonl"))).sort(newestFirst("detected_at"));
  const { dataset } = await gcpConfig();
  return bq(`SELECT * FROM ${dataset}.alerts ORDER BY detected_at DESC LIMIT ${LIMIT}`);
}

async function deadletters(): Promise<Json[]> {
  if (SOURCE === "local") return (await readJsonl(path.join(ROOT, ".data/deadletter.jsonl"))).sort(newestFirst("received_at"));
  const { dataset } = await gcpConfig();
  return bq(`SELECT * FROM ${dataset}.deadletter ORDER BY received_at DESC LIMIT ${LIMIT}`);
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

async function rules(): Promise<Json[]> {
  const dir = path.join(ROOT, "detections/rules");
  const out: Json[] = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort()) {
    const yaml = await readFile(path.join(dir, file), "utf8");
    const rule = parseYaml(yaml) as Json;
    const fixtures: Record<string, string[]> = { should_fire: [], should_not_fire: [] };
    for (const kind of Object.keys(fixtures)) {
      const fdir = path.join(ROOT, "detections/tests", String(rule.id), kind);
      if (existsSync(fdir)) fixtures[kind] = (await readdir(fdir)).filter((f) => f.endsWith(".json")).sort();
    }
    out.push({ ...rule, enabled: rule.enabled !== false, file: `detections/rules/${file}`, yaml, fixtures });
  }
  return out;
}

async function runbooks(): Promise<Record<string, string>> {
  const md = await readFile(path.join(ROOT, "docs/runbooks.md"), "utf8");
  const parts = md.split(/^## /m);
  const out: Record<string, string> = { _general: parts[0]!.replace(/^# .*\n/, "").trim() };
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n");
    out[part.slice(0, nl).trim()] = part.slice(nl + 1).trim();
  }
  return out;
}

async function detectionTests(): Promise<Json> {
  const r = await run("go", ["run", "./cmd/detect", "test"], path.join(ROOT, "pipeline"), 300_000);
  const results = [...(r.stdout + r.stderr).matchAll(/^(PASS|FAIL)\s+(\S+)\s+(fire|no-fire)\s+(\S+)(.*)$/gm)].map((m) => ({
    status: m[1],
    rule: m[2],
    expect: m[3],
    fixture: m[4],
    detail: m[5]!.trim(),
  }));
  return { ok: r.ok, results, output: (r.stdout + r.stderr).slice(-4000), ranAt: new Date().toISOString() };
}

const TRIAGE_FIXTURES = ["--fixtures", "test/fixtures/demo", "--repo", "acme/payments-api", "--repo", "acme/data-platform"];

async function triage(): Promise<Json> {
  const dir = path.join(ROOT, "triager");
  const cli = path.join(dir, "dist/cli.js");
  if (!existsSync(cli) || (await stat(path.join(dir, "src/report.ts"))).mtimeMs > (await stat(cli)).mtimeMs) {
    const b = await run("npm", ["run", "-s", "build"], dir);
    if (!b.ok) throw new Error(`triager build failed: ${b.stderr}`);
  }
  const repos = process.env.TRIAGE_REPOS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const live = repos.length > 0 && !!process.env.GITHUB_TOKEN;
  const args = live ? ["--dry-run", ...repos.flatMap((r) => ["--repo", r])] : TRIAGE_FIXTURES;
  const plan = await run("node", [cli, "run", "--json", ...args], dir);
  if (!plan.stdout.trim()) throw new Error(`triager failed: ${plan.stderr}`);
  const gate = await run("node", [cli, "check", "--json", ...args], dir);
  const meta = live ? { now: new Date().toISOString() } : JSON.parse(await readFile(path.join(dir, "test/fixtures/demo/meta.json"), "utf8"));
  return {
    mode: live ? "live (dry run)" : "demo fixtures",
    repos: live ? repos : ["acme/payments-api", "acme/data-platform"],
    now: meta.now,
    ...JSON.parse(plan.stdout),
    gate: { passed: gate.ok, detail: safeJson(gate.stdout.trim()) },
  };
}

async function pipelineStatus(): Promise<Json> {
  if (SOURCE === "local") {
    let stats: unknown = null;
    let reachable = false;
    try {
      const res = await fetch("http://localhost:8080/stats", { signal: AbortSignal.timeout(1500) });
      stats = await res.json();
      reachable = res.ok;
    } catch {
      // stack is not running
    }
    const ps = await run("docker", ["compose", "ps", "--all", "--format", "json"]);
    const containers = ps.stdout
      .split("\n")
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => JSON.parse(l) as Json)
      .map((c) => ({ name: c.Service, state: c.State, health: c.Health, status: c.Status, image: c.Image }));
    return { source: "local", reachable, stats, containers, dataDir: ".data/" };
  }

  const cfg = await gcpConfig();
  const tf = await terraformOutputs();
  const settle = async <T,>(p: Promise<T>) => p.then((v) => v, (e: Error) => ({ error: e.message }));
  const [service, sink, subscription, dlq] = await Promise.all([
    settle(gcp(`https://run.googleapis.com/v2/projects/${cfg.project}/locations/${cfg.region}/services/${cfg.service}`)),
    settle(gcp(`https://logging.googleapis.com/v2/projects/${cfg.project}/sinks/falcon-audit-sink`)),
    settle(gcp(`https://pubsub.googleapis.com/v1/projects/${cfg.project}/subscriptions/falcon-audit-logs-pipeline-push`)),
    settle(bq(`SELECT COUNT(*) AS n FROM ${cfg.dataset}.deadletter`)),
  ]);
  const counts = await settle(
    bq(`SELECT (SELECT COUNT(*) FROM ${cfg.dataset}.events) AS events,
               (SELECT COUNT(*) FROM ${cfg.dataset}.alerts) AS alerts,
               (SELECT COUNT(*) FROM ${cfg.dataset}.deadletter) AS dead_lettered,
               (SELECT MAX(ts) FROM ${cfg.dataset}.events) AS last_event`),
  );
  const s = service as Json;
  const container = ((s.template as Json | undefined)?.containers as Json[] | undefined)?.[0];
  return {
    source: "gcp",
    project: cfg.project,
    region: cfg.region,
    reachable: !("error" in s),
    stats: Array.isArray(counts) ? counts[0] : counts,
    cloudRun: "error" in s
      ? s
      : {
          name: cfg.service,
          uri: s.uri,
          ingress: s.ingress,
          image: container?.image,
          latestReadyRevision: String(s.latestReadyRevision ?? "").split("/").pop(),
          conditions: ((s.conditions as Json[] | undefined) ?? []).map((c) => ({ type: c.type, state: c.state })),
          updateTime: s.updateTime,
        },
    sink: "error" in (sink as Json) ? sink : { name: (sink as Json).name, destination: (sink as Json).destination, filter: (sink as Json).filter, writer: (sink as Json).writerIdentity },
    subscription: "error" in (subscription as Json)
      ? subscription
      : {
          name: String((subscription as Json).name).split("/").pop(),
          endpoint: ((subscription as Json).pushConfig as Json | undefined)?.pushEndpoint,
          deadLetterTopic: ((subscription as Json).deadLetterPolicy as Json | undefined)?.deadLetterTopic,
          maxDeliveryAttempts: ((subscription as Json).deadLetterPolicy as Json | undefined)?.maxDeliveryAttempts,
          ackDeadlineSeconds: (subscription as Json).ackDeadlineSeconds,
        },
    deadLettered: Array.isArray(dlq) ? dlq[0]?.n : dlq,
    terraform: tf,
  };
}

async function meta(): Promise<Json> {
  const base = { source: SOURCE, generatedAt: new Date().toISOString() };
  if (SOURCE === "local") return { ...base, label: "Local stack (.data/*.jsonl)" };
  const cfg = await gcpConfig();
  return { ...base, label: `GCP · ${cfg.project}`, project: cfg.project, region: cfg.region };
}

// ---------------------------------------------------------------- http

const routes: Record<string, () => Promise<unknown>> = {
  "GET /api/meta": meta,
  "GET /api/events": events,
  "GET /api/alerts": alerts,
  "GET /api/deadletters": deadletters,
  "GET /api/rules": rules,
  "GET /api/runbooks": runbooks,
  "GET /api/triage": triage,
  "GET /api/pipeline": pipelineStatus,
  "POST /api/detections/test": detectionTests,
};

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".json": "application/json",
};

async function serveStatic(url: string, res: ServerResponse) {
  const rel = decodeURIComponent(url.split("?")[0]!).replace(/^\/+/, "");
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST) || !existsSync(file) || (await stat(file)).isDirectory()) file = path.join(DIST, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404).end("UI not built: run `npm run build`, or use `npm run dev`");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
}

// Several browser tabs or a fast refresh should not multiply cloud queries (each BigQuery
// read is audit-logged back into Falcon) or re-run the triager every few seconds.
const TTL_MS: Record<string, number> = { "GET /api/triage": 60_000 };
const DEFAULT_TTL_MS = SOURCE === "gcp" ? 30_000 : 0;
const cache = new Map<string, { at: number; body: Promise<string> }>();

function cached(key: string, route: () => Promise<unknown>): Promise<string> {
  const ttl = TTL_MS[key] ?? (key.startsWith("GET ") ? DEFAULT_TTL_MS : 0);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.body;
  const body = route().then((v) => JSON.stringify(v));
  cache.set(key, { at: Date.now(), body });
  body.catch(() => cache.delete(key));
  return body;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? "/";
  const key = `${req.method} ${url.split("?")[0]}`;
  const route = routes[key];
  if (!route) {
    if (url.startsWith("/api/")) res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"not found"}');
    else await serveStatic(url, res);
    return;
  }
  try {
    const body = await cached(key, route);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: (err as Error).message }));
  }
}

// Bound to localhost: the console can read the security dataset with your credentials.
createServer((req, res) => void handle(req, res)).listen(PORT, "127.0.0.1", () => {
  console.log(`falcon console API on http://127.0.0.1:${PORT}  source=${SOURCE}`);
});
