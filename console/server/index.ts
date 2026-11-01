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

// ---------------------------------------------------------------- resource monitoring

interface Metric {
  key: string;
  type: string;
  resource: string;
  aligner: string;
  reducer?: string;
  groupBy?: string;
}

const PUSH_SUB = "falcon-audit-logs-pipeline-push";
const DLQ_SUB = "falcon-audit-logs-dead-letter-pull";
const SCHEDULER_REGION = "europe-west1";

function metrics(service: string): Metric[] {
  const run = `resource.type="cloud_run_revision" AND resource.labels.service_name="${service}"`;
  const sub = (id: string) => `resource.type="pubsub_subscription" AND resource.labels.subscription_id="${id}"`;
  const sink = `resource.type="logging_sink" AND resource.labels.name="falcon-audit-sink"`;
  const m = "run.googleapis.com";
  const ps = "pubsub.googleapis.com/subscription";
  return [
    { key: "cpu", type: `${m}/container/cpu/utilizations`, resource: run, aligner: "ALIGN_PERCENTILE_95", reducer: "REDUCE_MAX" },
    { key: "memory", type: `${m}/container/memory/utilizations`, resource: run, aligner: "ALIGN_PERCENTILE_95", reducer: "REDUCE_MAX" },
    { key: "instances", type: `${m}/container/instance_count`, resource: run, aligner: "ALIGN_MAX", reducer: "REDUCE_SUM", groupBy: "state" },
    { key: "requests", type: `${m}/request_count`, resource: run, aligner: "ALIGN_SUM", reducer: "REDUCE_SUM", groupBy: "response_code_class" },
    { key: "latency", type: `${m}/request_latencies`, resource: run, aligner: "ALIGN_PERCENTILE_95", reducer: "REDUCE_MAX" },
    { key: "backlog", type: `${ps}/num_undelivered_messages`, resource: sub(PUSH_SUB), aligner: "ALIGN_MAX", reducer: "REDUCE_SUM" },
    { key: "oldest", type: `${ps}/oldest_unacked_message_age`, resource: sub(PUSH_SUB), aligner: "ALIGN_MAX", reducer: "REDUCE_MAX" },
    { key: "pushes", type: `${ps}/push_request_count`, resource: sub(PUSH_SUB), aligner: "ALIGN_SUM", reducer: "REDUCE_SUM", groupBy: "response_class" },
    { key: "dlq", type: `${ps}/num_undelivered_messages`, resource: sub(DLQ_SUB), aligner: "ALIGN_MAX", reducer: "REDUCE_SUM" },
    { key: "exported", type: "logging.googleapis.com/exports/log_entry_count", resource: sink, aligner: "ALIGN_SUM", reducer: "REDUCE_SUM" },
    { key: "exportErrors", type: "logging.googleapis.com/exports/error_count", resource: sink, aligner: "ALIGN_SUM", reducer: "REDUCE_SUM" },
  ];
}

interface Series {
  label: string;
  points: { t: string; v: number }[];
}

async function timeSeries(project: string, m: Metric, hours: number): Promise<Series[]> {
  const end = new Date();
  const q = new URLSearchParams({
    filter: `metric.type="${m.type}" AND ${m.resource}`,
    "interval.startTime": new Date(end.getTime() - hours * 3600_000).toISOString(),
    "interval.endTime": end.toISOString(),
    "aggregation.alignmentPeriod": `${hours === 1 ? 60 : hours === 6 ? 300 : 900}s`,
    "aggregation.perSeriesAligner": m.aligner,
  });
  if (m.reducer) q.set("aggregation.crossSeriesReducer", m.reducer);
  if (m.groupBy) q.set("aggregation.groupByFields", `metric.labels.${m.groupBy}`);
  const res = await gcp(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${q}`);
  const list = (res.timeSeries ?? []) as { metric?: { labels?: Record<string, string> }; points?: { interval: { endTime: string }; value: { doubleValue?: number; int64Value?: string } }[] }[];
  return list.map((ts) => ({
    label: (m.groupBy && ts.metric?.labels?.[m.groupBy]) || "value",
    points: (ts.points ?? []).map((p) => ({ t: p.interval.endTime, v: Number(p.value.doubleValue ?? p.value.int64Value ?? 0) })).reverse(),
  }));
}

// A resource that does not exist is an ordinary state here (nothing is deployed), not an error.
async function optional(url: string): Promise<Json | null> {
  try {
    return await gcp(url);
  } catch (e) {
    if (/^404 /.test((e as Error).message)) return null;
    throw e;
  }
}

async function resources(url: URL): Promise<Json> {
  const requested = Number(url.searchParams.get("hours"));
  const hours = [1, 6, 24].includes(requested) ? requested : 1;

  if (SOURCE === "local") {
    const [stats, ps, info, messages] = await Promise.all([
      run("docker", ["stats", "--no-stream", "--format", "json"], ROOT, 20_000),
      run("docker", ["ps", "--format", "json"], ROOT),
      run("docker", ["info", "--format", "{{.NCPU}}"], ROOT),
      fetch("http://localhost:8080/stats", { signal: AbortSignal.timeout(1500) }).then((r) => (r.ok ? (r.json() as Promise<Json>) : undefined), () => undefined),
    ]);
    const lines = (out: string) => out.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l) as Json);
    const statusOf = new Map(lines(ps.stdout).map((c) => [String(c.Names), String(c.Status)]));
    const containers = lines(stats.stdout)
      .filter((c) => String(c.Name).startsWith("falcon-"))
      .map((c) => {
        const status = statusOf.get(String(c.Name)) ?? "";
        const [memoryUsed, memoryLimit] = String(c.MemUsage).split(" / ");
        return {
          name: c.Name,
          uptime: status.replace(/^Up\s+/, "").replace(/\s*\(.*\)$/, ""),
          health: /\((.+)\)$/.exec(status)?.[1],
          cpuPercent: parseFloat(String(c.CPUPerc)),
          memoryPercent: parseFloat(String(c.MemPerc)),
          memoryUsed,
          memoryLimit,
          network: c.NetIO,
        };
      });
    return { source: "local", hours, cpus: Number(info.stdout.trim()) || undefined, containers, messages };
  }

  const cfg = await gcpConfig();
  const settle = <T,>(p: Promise<T>) => p.then((v) => v, (e: Error) => ({ error: e.message }));
  const specs = metrics(cfg.service);
  const results = await Promise.all(specs.map((m) => settle(timeSeries(cfg.project, m, hours))));
  const bq = `https://bigquery.googleapis.com/bigquery/v2/projects/${cfg.project}/datasets/${cfg.dataset}/tables`;
  const [tables, scheduler, registry] = await Promise.all([
    settle(Promise.all(["events", "alerts", "deadletter"].map(async (name) => {
      const t = await optional(`${bq}/${name}`);
      if (!t) return { name, exists: false };
      const buffer = t.streamingBuffer as Json | undefined;
      return {
        name,
        exists: true,
        rows: Number(t.numRows ?? 0),
        bytes: Number(t.numBytes ?? 0),
        buffered: Number(buffer?.estimatedRows ?? 0),
        modified: Number(t.lastModifiedTime ?? 0),
      };
    }))),
    settle(optional(`https://cloudscheduler.googleapis.com/v1/projects/${cfg.project}/locations/${SCHEDULER_REGION}/jobs`)),
    settle(optional(`https://artifactregistry.googleapis.com/v1/projects/${cfg.project}/locations/${cfg.region}/repositories/falcon`)),
  ]);
  const jobs = (scheduler as Json | null)?.jobs as Json[] | undefined;
  return {
    source: "gcp",
    project: cfg.project,
    region: cfg.region,
    hours,
    metrics: Object.fromEntries(specs.map((m, i) => [m.key, results[i]])),
    tables,
    scheduler: scheduler && "error" in scheduler
      ? scheduler
      : (jobs ?? []).map((j) => ({
          name: String(j.name).split("/").pop(),
          state: j.state,
          schedule: j.schedule,
          lastAttempt: j.lastAttemptTime,
          status: (j.status as Json | undefined)?.code ?? 0,
        })),
    registry: registry && "error" in registry
      ? registry
      : registry && { name: "falcon", sizeBytes: Number(registry.sizeBytes ?? 0) },
  };
}

async function meta(): Promise<Json> {
  const base = { source: SOURCE, generatedAt: new Date().toISOString() };
  if (SOURCE === "local") return { ...base, label: "Local stack (.data/*.jsonl)" };
  const cfg = await gcpConfig();
  return { ...base, label: `GCP · ${cfg.project}`, project: cfg.project, region: cfg.region };
}

// ---------------------------------------------------------------- http

const routes: Record<string, (url: URL) => Promise<unknown>> = {
  "GET /api/meta": meta,
  "GET /api/events": events,
  "GET /api/alerts": alerts,
  "GET /api/deadletters": deadletters,
  "GET /api/rules": rules,
  "GET /api/runbooks": runbooks,
  "GET /api/triage": triage,
  "GET /api/pipeline": pipelineStatus,
  "GET /api/resources": resources,
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

function cached(key: string, url: URL, route: (url: URL) => Promise<unknown>): Promise<string> {
  const ttl = TTL_MS[key] ?? (key.startsWith("GET ") ? DEFAULT_TTL_MS : 0);
  const entry = key + url.search;
  const hit = cache.get(entry);
  if (hit && Date.now() - hit.at < ttl) return hit.body;
  const body = route(url).then((v) => JSON.stringify(v));
  cache.set(entry, { at: Date.now(), body });
  body.catch(() => cache.delete(entry));
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
    const body = await cached(key, new URL(url, "http://localhost"), route);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: (err as Error).message }));
  }
}

// Bound to localhost: the console can read the security dataset with your credentials.
createServer((req, res) => void handle(req, res)).listen(PORT, "127.0.0.1", () => {
  console.log(`falcon console API on http://127.0.0.1:${PORT}  source=${SOURCE}`);
});
