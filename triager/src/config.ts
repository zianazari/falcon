import { readFile } from "node:fs/promises";
import type { Priority } from "./types.js";

export interface Config {
  /** SLA in days from when the alert was opened. */
  slaDays: Record<Priority, number>;
  /** Minimum score for each priority; anything lower is P4. */
  thresholds: { P1: number; P2: number; P3: number };
  /** Owner used when no CODEOWNERS rule matches. */
  defaultOwners: string[];
  /** File issues in this repo instead of the alert's repo (a central security tracker). */
  issueRepo?: string;
  /** Lowest priority that gets an issue. Lower ones appear in the report only. */
  minIssuePriority: Priority;
  /** Days between nudges on an overdue issue. */
  nudgeIntervalDays: number;
  /** `check` fails on overdue findings at this priority or higher. */
  gatePriority: Priority;
}

export const defaultConfig: Config = {
  slaDays: { P1: 7, P2: 30, P3: 90, P4: 180 },
  thresholds: { P1: 70, P2: 40, P3: 20 },
  defaultOwners: ["@acme/security"],
  minIssuePriority: "P3",
  nudgeIntervalDays: 7,
  gatePriority: "P2",
};

export async function loadConfig(path?: string): Promise<Config> {
  if (!path) return defaultConfig;
  const override = JSON.parse(await readFile(path, "utf8")) as Partial<Config>;
  return { ...defaultConfig, ...override };
}
