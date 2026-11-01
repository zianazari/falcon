# Writing detections

A detection is a YAML file in `rules/` and at least two fixtures in `tests/<rule-id>/`.
CI fails if any rule has no `should_fire` or no `should_not_fire` fixture, or if a fixture
behaves differently from what its directory says.

## Rule format

```yaml
id: gcp-bucket-made-public          # kebab-case, unique; also the fixtures directory name
title: Cloud Storage bucket made public
description: Why this matters and what to look for.
severity: critical                  # low | medium | high | critical
mitre: [T1530]
runbook: docs/runbooks.md#gcp-bucket-made-public
enabled: true                       # optional, default true
match:
  all:
    - field: action
      equals: storage.setIamPermissions
    - some: iam_deltas              # true if ANY element matches the whole `where`
      where:
        all:
          - field: action
            equals: ADD
          - field: member
            in: [allUsers, allAuthenticatedUsers]
```

Unknown keys are errors, so a typo such as `equal:` fails CI instead of silently never matching.

### Conditions

| Combinator | Meaning |
|---|---|
| `all: [...]` | every child matches |
| `any: [...]` | at least one child matches |
| `not: {...}` | the child does not match |
| `some: <list field>` + `where: {...}` | at least one list element matches `where`, evaluated against that element |

| Operator (with `field:`) | Meaning |
|---|---|
| `equals: v` | string form is equal (numbers and booleans work too) |
| `in: [a, b]` | equals any value in the list |
| `contains` / `starts_with` / `ends_with` | substring tests |
| `regex: '...'` | RE2 regular expression |
| `exists: true\|false` | the field is present and non-null |

If a field resolves to a list (for example `raw.protoPayload.request.sourceRanges`), the
condition matches when **any** element matches. Use `some` when several conditions must hold
for the **same** element. Matching `ADD` in one delta and `roles/owner` in another must not fire.

### Fields

Normalized fields: `id ts source log_type service action resource project actor actor_type
src_ip ip_class user_agent outcome status_code status_message severity iam_deltas[].{action,role,member}`.

- `actor_type`: `user`, `service_account`, `google_managed` or `anonymous`
- `ip_class`: `public`, `internal`, `none` or `unknown`
- `outcome`: `success` or `failure`. Most rules should require `success`; failed attempts
  are a separate, lower-severity signal.

Everything in the original LogEntry is reachable under `raw.`, for example
`raw.protoPayload.request.direction`.

## Workflow

```bash
# 1. Find a real example: Logs Explorer, then copy the LogEntry JSON into a fixture
# 2. See how it normalizes and which rules it triggers
cd pipeline && go run ./cmd/detect run ../detections/tests/<rule>/should_fire/<case>.json
# 3. Write the rule, add should_not_fire near-misses (denied calls, benign variants)
make detect-test
```
