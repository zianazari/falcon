import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IssueDraft, IssuePatch, Platform } from "./platform.js";
import type { CodeScanningAlert, DependabotAlert, Issue } from "./types.js";

/**
 * Reads recorded API responses from <dir>/repos/<owner>__<repo>/:
 *   dependabot.json, code-scanning.json, issues.json, CODEOWNERS
 * A missing file behaves like the feature being disabled. Writes are refused:
 * fixture runs are always dry runs.
 */
export class FixturePlatform implements Platform {
  constructor(private readonly dir: string) {}

  private async read(repo: string, file: string): Promise<string | null> {
    try {
      return await readFile(join(this.dir, "repos", repo.replace("/", "__"), file), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  private async json<T>(repo: string, file: string): Promise<T[]> {
    const text = await this.read(repo, file);
    return text ? (JSON.parse(text) as T[]) : [];
  }

  dependabotAlerts(repo: string): Promise<DependabotAlert[]> {
    return this.json(repo, "dependabot.json");
  }

  codeScanningAlerts(repo: string): Promise<CodeScanningAlert[]> {
    return this.json(repo, "code-scanning.json");
  }

  codeowners(repo: string): Promise<string | null> {
    return this.read(repo, "CODEOWNERS");
  }

  falconIssues(repo: string): Promise<Issue[]> {
    return this.json(repo, "issues.json");
  }

  createIssue(_repo: string, _draft: IssueDraft): Promise<number> {
    throw new Error("fixture platform is read-only");
  }

  updateIssue(_repo: string, _n: number, _p: IssuePatch): Promise<void> {
    throw new Error("fixture platform is read-only");
  }

  comment(_repo: string, _n: number, _b: string): Promise<void> {
    throw new Error("fixture platform is read-only");
  }
}
