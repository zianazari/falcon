/**
 * A CODEOWNERS parser following GitHub's rules: gitignore-style patterns,
 * and the last matching line wins.
 */
export interface OwnerRule {
  pattern: string;
  owners: string[];
  regex: RegExp;
}

export function parseCodeowners(text: string): OwnerRule[] {
  const rules: OwnerRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    if (!pattern) continue;
    rules.push({ pattern, owners, regex: patternToRegex(pattern) });
  }
  return rules;
}

export function ownersFor(rules: OwnerRule[], path: string): string[] | undefined {
  const p = path.replace(/^\/+/, "");
  let match: string[] | undefined;
  for (const r of rules) if (r.regex.test(p)) match = r.owners;
  // A matching line with no owners deliberately un-owns the path.
  return match && match.length > 0 ? match : undefined;
}

export function patternToRegex(pattern: string): RegExp {
  let p = pattern;
  // A slash at the start or in the middle anchors the pattern to the repo root.
  const anchored = p.startsWith("/") || p.slice(0, -1).includes("/");
  p = p.replace(/^\//, "");
  if (p.endsWith("/")) p += "**";

  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === "*" && p[i + 1] === "*") {
      if (p[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  // A pattern that names a directory also owns everything inside it.
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${re}(?:/.*)?$`);
}
