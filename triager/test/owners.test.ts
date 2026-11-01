import { describe, expect, it } from "vitest";
import { ownersFor, parseCodeowners } from "../src/owners.js";

const CODEOWNERS = `
# comment
*                      @acme/platform
/services/checkout/    @acme/checkout   # inline comment
/services/ledger/      @acme/ledger @alice
*.tf                   @acme/sre
/docs/**/*.md          @acme/docs
/package-lock.json     @acme/platform-deps
/services/legacy/
`;

describe("CODEOWNERS", () => {
  const rules = parseCodeowners(CODEOWNERS);

  it.each([
    ["services/checkout/package-lock.json", ["@acme/checkout"]],
    ["services/ledger/pom.xml", ["@acme/ledger", "@alice"]],
    ["README.md", ["@acme/platform"]],
    ["infra/envs/dev/main.tf", ["@acme/sre"]], // unanchored: matches at any depth
    ["docs/guides/deep/setup.md", ["@acme/docs"]], // ** spans directories
    ["package-lock.json", ["@acme/platform-deps"]],
    ["services/checkout/package-lock.json", ["@acme/checkout"]], // anchored rule does not leak
    ["/services/checkout/x.ts", ["@acme/checkout"]], // leading slash in the path is ignored
  ])("%s -> %j", (path, owners) => {
    expect(ownersFor(rules, path)).toEqual(owners);
  });

  it("last matching rule wins", () => {
    const r = parseCodeowners("/services/ @a\n/services/checkout/ @b\n");
    expect(ownersFor(r, "services/checkout/a.ts")).toEqual(["@b"]);
    expect(ownersFor(r, "services/other/a.ts")).toEqual(["@a"]);
  });

  it("a rule with no owners un-owns the path", () => {
    expect(ownersFor(rules, "services/legacy/old.js")).toBeUndefined();
  });

  it("does not treat dots as wildcards", () => {
    const r = parseCodeowners("go.mod @go\n");
    expect(ownersFor(r, "goXmod")).toBeUndefined();
    expect(ownersFor(r, "ingest/go.mod")).toEqual(["@go"]);
  });
});
