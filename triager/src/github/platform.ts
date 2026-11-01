import { Octokit } from "@octokit/rest";
import type { CodeScanningAlert, DependabotAlert, Issue } from "./types.js";

export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
}

export interface IssuePatch {
  title?: string;
  body?: string;
  labels?: string[];
  state?: "open" | "closed";
}

/** Everything the triager needs from GitHub. Swapped for fixtures in tests and the demo. */
export interface Platform {
  dependabotAlerts(repo: string): Promise<DependabotAlert[]>;
  codeScanningAlerts(repo: string): Promise<CodeScanningAlert[]>;
  codeowners(repo: string): Promise<string | null>;
  /** All issues (open and closed) labelled `falcon`. */
  falconIssues(repo: string): Promise<Issue[]>;
  createIssue(repo: string, draft: IssueDraft): Promise<number>;
  updateIssue(repo: string, number: number, patch: IssuePatch): Promise<void>;
  comment(repo: string, number: number, body: string): Promise<void>;
}

export const FALCON_LABEL = "falcon";

function split(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`repo must be owner/name, got "${repo}"`);
  return { owner, repo: name };
}

function status(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "status" in err ? (err as { status: number }).status : undefined;
}

export class GitHubPlatform implements Platform {
  private readonly octokit: Octokit;

  constructor(token: string, private readonly warn: (msg: string) => void = console.warn) {
    this.octokit = new Octokit({ auth: token, userAgent: "falcon-triager" });
  }

  async dependabotAlerts(repo: string): Promise<DependabotAlert[]> {
    try {
      // No state filter: fixed and dismissed alerts are needed to close their issues.
      return (await this.octokit.paginate(this.octokit.rest.dependabot.listAlertsForRepo, {
        ...split(repo),
        per_page: 100,
      })) as unknown as DependabotAlert[];
    } catch (err) {
      if (status(err) === 403 || status(err) === 404) {
        this.warn(`${repo}: Dependabot alerts unavailable (disabled, or token lacks "Dependabot alerts: read")`);
        return [];
      }
      throw err;
    }
  }

  async codeScanningAlerts(repo: string): Promise<CodeScanningAlert[]> {
    try {
      return (await this.octokit.paginate(this.octokit.rest.codeScanning.listAlertsForRepo, {
        ...split(repo),
        per_page: 100,
      })) as unknown as CodeScanningAlert[];
    } catch (err) {
      if (status(err) === 403 || status(err) === 404) {
        this.warn(`${repo}: code scanning not enabled, skipping`);
        return [];
      }
      throw err;
    }
  }

  async codeowners(repo: string): Promise<string | null> {
    for (const path of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
      try {
        const res = await this.octokit.rest.repos.getContent({ ...split(repo), path });
        if (!Array.isArray(res.data) && res.data.type === "file" && "content" in res.data) {
          return Buffer.from(res.data.content, "base64").toString("utf8");
        }
      } catch (err) {
        if (status(err) !== 404) throw err;
      }
    }
    return null;
  }

  async falconIssues(repo: string): Promise<Issue[]> {
    const issues = (await this.octokit.paginate(this.octokit.rest.issues.listForRepo, {
      ...split(repo),
      labels: FALCON_LABEL,
      state: "all",
      per_page: 100,
    })) as Issue[];
    return issues.filter((i) => !i.pull_request);
  }

  async createIssue(repo: string, draft: IssueDraft): Promise<number> {
    const res = await this.octokit.rest.issues.create({ ...split(repo), ...draft });
    return res.data.number;
  }

  async updateIssue(repo: string, number: number, patch: IssuePatch): Promise<void> {
    await this.octokit.rest.issues.update({ ...split(repo), issue_number: number, ...patch });
  }

  async comment(repo: string, number: number, body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({ ...split(repo), issue_number: number, body });
  }
}
