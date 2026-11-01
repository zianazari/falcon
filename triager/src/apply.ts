import type { Platform } from "./github/platform.js";
import { issueBody, issueLabels, issueTitle, nudgeComment } from "./issues.js";
import type { Action } from "./plan.js";

/** Executes the planned issue changes. */
export async function apply(platform: Platform, actions: Action[], now: Date, log: (s: string) => void): Promise<void> {
  for (const a of actions) {
    switch (a.kind) {
      case "create": {
        const n = await platform.createIssue(a.repo, {
          title: issueTitle(a.triaged),
          body: issueBody(a.triaged),
          labels: issueLabels(a.triaged),
        });
        log(`created ${a.repo}#${n}`);
        break;
      }
      case "update":
        await platform.updateIssue(a.issue.repo, a.issue.number, {
          title: issueTitle(a.triaged),
          body: issueBody(a.triaged, a.issue.lastNudge),
          labels: issueLabels(a.triaged),
        });
        await platform.comment(a.issue.repo, a.issue.number,
          `Priority changed from ${a.from} to **${a.triaged.priority}**:\n${a.triaged.reasons.map((r) => `- ${r}`).join("\n")}`);
        log(`updated ${a.issue.repo}#${a.issue.number} (${a.from} -> ${a.triaged.priority})`);
        break;
      case "nudge":
        await platform.comment(a.issue.repo, a.issue.number, nudgeComment(a.triaged));
        // The nudge time lives in the body, so the next run sees it without reading comments.
        await platform.updateIssue(a.issue.repo, a.issue.number, { body: issueBody(a.triaged, now) });
        log(`nudged ${a.issue.repo}#${a.issue.number}`);
        break;
      case "reopen":
        await platform.updateIssue(a.issue.repo, a.issue.number, { state: "open", body: issueBody(a.triaged, a.issue.lastNudge) });
        await platform.comment(a.issue.repo, a.issue.number,
          "Reopened: the alert is still open. Fix the vulnerability or dismiss the alert with a reason, and Falcon will close this.");
        log(`reopened ${a.issue.repo}#${a.issue.number}`);
        break;
      case "close":
        await platform.comment(a.issue.repo, a.issue.number, `Resolved: ${a.reason}. Closing.`);
        await platform.updateIssue(a.issue.repo, a.issue.number, { state: "closed" });
        log(`closed ${a.issue.repo}#${a.issue.number}`);
        break;
      case "report-only":
      case "ok":
        break;
    }
  }
}
