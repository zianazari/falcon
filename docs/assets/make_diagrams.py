"""Generates the animated README diagrams.

Usage: python3 docs/assets/make_diagrams.py docs/assets   (or: make diagrams)

Plain SVG with CSS keyframes and SMIL, so the animations play inside a GitHub
README <img>. Colors follow prefers-color-scheme; prefers-reduced-motion shows
the final, fully revealed frame.
"""
import os
import re
import sys
from xml.sax.saxutils import escape

OUT = sys.argv[1]
BIG = ' font-size="14"'
WHITE = ' style="fill:#fff"'
WHITE11 = ' style="fill:#fff;font-size:11px"'

BASE_CSS = """
svg{--bg:#ffffff;--card:#f6f8fa;--ink:#1f2328;--muted:#59636e;--line:#d1d9e0;--accent:#0969da;--alert:#cf222e;
--ok:#1a7f37;--warn:#9a6700;--code:#eef1f4;--chip:#ddf4ff}
@media (prefers-color-scheme: dark){svg{--bg:#0d1117;--card:#151b23;--ink:#e6edf3;--muted:#9198a1;--line:#3d444d;
--accent:#4493f8;--alert:#f85149;--ok:#3fb950;--warn:#d29922;--code:#1f2630;--chip:#0c2d6b}}
text{white-space:pre;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;fill:var(--ink);font-size:12px}
.bg{fill:var(--bg);stroke:var(--line)}
.card{fill:var(--card);stroke:var(--line);stroke-width:1.2}
.code{fill:var(--code)}
.mono{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;font-size:11px}
.h1{font-size:15px;font-weight:600}
.ct{font-size:13px;font-weight:600}
.sub{fill:var(--muted);font-size:11px}
.muted{fill:var(--muted)}
.accent{fill:var(--accent)}
.alert{fill:var(--alert)}
.ok{fill:var(--ok)}
.warn{fill:var(--warn)}
.b{font-weight:600}
.num{fill:var(--accent)}
.numt{fill:#fff;font-size:11px;font-weight:700}
.line{stroke:var(--line);stroke-width:1.5;fill:none}
.flow{stroke:var(--muted);stroke-width:1.5;fill:none}
.dash{stroke-dasharray:4 4}
.chipbg{fill:var(--chip)}
.alertbg{fill:var(--alert)}
.okbg{fill:var(--ok)}
.warnbg{fill:var(--warn)}
.accentbg{fill:var(--accent)}
.mutedbg{fill:var(--line)}
.bar{transform-box:fill-box;transform-origin:left center}
.ah{fill:var(--muted)}
@media (prefers-reduced-motion: reduce){*{animation:none!important}.packet{display:none}}
"""


def t(x, y, s, cls="", anchor=None, extra=""):
    a = f' text-anchor="{anchor}"' if anchor else ""
    c = f' class="{cls}"' if cls else ""
    return f'<text x="{x}" y="{y}"{c}{a}{extra}>{escape(s)}</text>'


def rect(x, y, w, h, cls, rx=6, extra=""):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" class="{cls}"{extra}/>'


def svg(w, h, title, desc, body, css):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'role="img" aria-labelledby="title desc" xml:space="preserve">\n<title id="title">{escape(title)}</title>\n'
            f'<desc id="desc">{escape(desc)}</desc>\n<style>{BASE_CSS}{css}</style>\n'
            f'<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
            f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ah"/></marker></defs>\n'
            f'{rect(0.5, 0.5, w - 1, h - 1, "bg", 12)}\n{body}\n</svg>\n')


class Timeline:
    """CSS keyframes on one shared loop. Elements without animation show their
    final state, which is also what reduced-motion users see."""

    def __init__(self, total, hold_end):
        self.total, self.hold_end, self.css, self.n = total, hold_end, [], 0

    def p(self, sec):
        return f"{max(0.0, min(100.0, sec / self.total * 100)):.2f}%"

    def _add(self, frames):
        name = f"k{self.n}"
        self.n += 1
        self.css.append(f"@keyframes {name}{{{frames}}}.{name}{{animation:{name} {self.total}s linear infinite}}")
        return name

    def show(self, start, frm="opacity:0", to="opacity:1", dur=0.35):
        """Hidden until start, then visible until the loop resets."""
        p = self.p
        return self._add(f"0%,{p(start)}{{{frm}}}{p(start + dur)},{p(self.hold_end)}{{{to}}}"
                         f"{p(self.hold_end + 0.4)},100%{{{frm}}}")

    def window(self, start, end, off, on, dur=0.3):
        """`on` between start and end, `off` otherwise."""
        p = self.p
        return self._add(f"0%,{p(start)}{{{off}}}{p(start + dur)},{p(end)}{{{on}}}{p(end + dur)},100%{{{off}}}")

    def style(self):
        return "".join(self.css)


def grid_card(tl, x, y, w, h, num, title, start, end, dashed=False):
    """Card that is faint until its step, outlined while active."""
    g = tl.show(start, "opacity:.22", "opacity:1")
    r = tl.window(start, end, "stroke:var(--line);stroke-width:1.2", "stroke:var(--accent);stroke-width:2.4")
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    return (f'<g class="{g}">{rect(x, y, w, h, "card " + r, 10, dash)}'
            f'<circle cx="{x + 22}" cy="{y + 22}" r="11" class="num"/>'
            f'{t(x + 22, y + 26, str(num), "numt", "middle")}{t(x + 40, y + 27, title, "ct")}')


# --------------------------------------------------------------------------
# 1. Architecture: packets flowing through the two lanes.
# --------------------------------------------------------------------------
def architecture():
    W, H = 960, 430
    b = []

    def box(x, y, w, h, title, sub, cls="card"):
        b.append(rect(x, y, w, h, cls, 8))
        if not sub:
            b.append(t(x + w / 2, y + h / 2 + 4, title, "b", "middle"))
            return
        b.append(t(x + w / 2, y + h / 2 - 2, title, "b", "middle"))
        b.append(t(x + w / 2, y + h / 2 + 14, sub, "sub", "middle"))

    b.append(t(24, 32, "1 · DETECT", "h1 accent"))
    b.append(t(112, 32, "cloud attacks, streamed in real time", "sub"))

    # Arrows first so boxes sit on top.
    for d in ["M150,90 H185", "M295,90 H330", "M450,90 H488", "M702,78 C730,78 730,70 758,70",
              "M702,104 C730,104 730,134 758,134"]:
        b.append(f'<path d="{d}" class="flow" marker-end="url(#arrow)"/>')
    b.append('<path d="M390,112 V160" class="flow dash" marker-end="url(#arrow)"/>')
    b.append('<path d="M595,170 V134" class="flow dash" marker-end="url(#arrow)"/>')

    box(20, 64, 130, 52, "Cloud Audit Logs", "every GCP API call")
    box(185, 64, 110, 52, "Log sink", "audit filter")
    box(330, 64, 120, 52, "Pub/Sub", "push · OIDC auth")
    box(330, 162, 120, 46, "Dead-letter", "after 5 failures")

    b.append(rect(488, 46, 214, 88, "card", 8))
    b.append(t(595, 66, "Cloud Run · Go pipeline", "b", "middle"))
    b.append(t(595, 82, "internal ingress only", "sub", "middle"))
    for i, name in enumerate(["normalize", "detect", "sink"]):
        cls = "chipbg detectchip" if name == "detect" else "chipbg"
        b.append(rect(500 + i * 66, 96, 58, 26, cls, 13))
        b.append(t(529 + i * 66, 113, name, "", "middle"))

    b.append(rect(488, 172, 214, 46, "card", 8, ' stroke-dasharray="5 4"'))
    b.append(t(595, 191, "detections/*.yaml", "b mono", "middle"))
    b.append(t(595, 207, "tested in CI · baked into the image", "sub", "middle"))

    box(758, 46, 182, 50, "BigQuery", "events · alerts · deadletter")
    b.append(rect(758, 110, 182, 50, "card slack", 8))
    b.append(t(849, 132, "Slack", "b", "middle"))
    b.append(t(849, 148, "alert → on-call human", "sub", "middle"))

    # Normal events: a steady blue stream into BigQuery.
    stream = "M150,90 H702 C730,90 730,70 758,70"
    for i in range(6):
        b.append(f'<circle r="4.5" class="packet accentbg"><animateMotion dur="5s" begin="{i * 0.83:.2f}s" '
                 f'repeatCount="indefinite" path="{stream}"/></circle>')

    # Every 8s a malicious event: red, branches to Slack, the detect chip flashes.
    alert_path = "M150,90 H702 C730,90 730,134 758,134"
    b.append('<circle r="6" class="packet alertbg">'
             f'<animateMotion dur="8s" begin="1s" repeatCount="indefinite" path="{alert_path}" '
             'keyPoints="0;1;1" keyTimes="0;0.55;1" calcMode="linear"/>'
             '<animate attributeName="opacity" dur="8s" begin="1s" repeatCount="indefinite" '
             'values="1;1;0;0" keyTimes="0;0.55;0.57;1"/></circle>')
    b.append('<rect x="500" y="96" width="58" height="26" rx="13" transform="translate(66 0)" class="packet alertbg" opacity="0">'
             '<animate attributeName="opacity" dur="8s" begin="1s" repeatCount="indefinite" '
             'values="0;0;.85;.85;0;0" keyTimes="0;0.36;0.38;0.46;0.48;1"/></rect>')
    b.append('<text x="595" y="113" text-anchor="middle" class="packet" opacity="0" style="fill:#fff;font-weight:600">'
             'MATCH<animate attributeName="opacity" dur="8s" begin="1s" repeatCount="indefinite" '
             'values="0;0;1;1;0;0" keyTimes="0;0.36;0.38;0.46;0.48;1"/></text>')
    b.append('<rect x="758" y="110" width="182" height="50" rx="8" class="packet" opacity="0" '
             'style="fill:none;stroke:var(--alert);stroke-width:3">'
             '<animate attributeName="opacity" dur="8s" begin="1s" repeatCount="indefinite" '
             'values="0;0;1;1;0" keyTimes="0;0.54;0.56;0.8;1"/></rect>')

    # A poison message drops into the dead-letter topic.
    b.append('<circle r="5" class="packet warnbg">'
             '<animateMotion dur="8s" begin="5s" repeatCount="indefinite" path="M150,90 H390 V185" '
             'keyPoints="0;1;1" keyTimes="0;0.35;1" calcMode="linear"/>'
             '<animate attributeName="opacity" dur="8s" begin="5s" repeatCount="indefinite" '
             'values="1;1;0;0" keyTimes="0;0.35;0.4;1"/></circle>')

    # Legend.
    for i, (cls, label) in enumerate([("accentbg", "normal event"), ("alertbg", "rule match"),
                                      ("warnbg", "malformed message")]):
        b.append(f'<circle cx="{30 + i * 130}" cy="232" r="5" class="{cls}"/>')
        b.append(t(40 + i * 130, 236, label, "sub"))

    b.append(f'<line x1="20" y1="256" x2="{W - 20}" y2="256" class="line dash"/>')

    # Triage lane.
    b.append(t(24, 286, "2 · TRIAGE", "h1 accent"))
    b.append(t(112, 286, "vulnerable dependencies and code, daily", "sub"))
    for d in ["M210,320 C250,320 260,350 298,350", "M210,364 H298", "M210,405 C250,405 260,378 298,378",
              "M548,350 C600,350 600,322 648,322", "M548,378 C600,378 600,394 648,394"]:
        b.append(f'<path d="{d}" class="flow" marker-end="url(#arrow)"/>')
    box(20, 300, 190, 40, "Dependabot + code scanning", "")
    box(20, 344, 190, 40, "EPSS · CISA KEV", "")
    box(20, 388, 190, 34, "CODEOWNERS", "")
    b.append(rect(298, 310, 250, 96, "card", 8))
    b.append(t(423, 332, "TypeScript triager", "b", "middle"))
    b.append(t(423, 348, "GitHub Actions · weekdays", "sub", "middle"))
    for i, name in enumerate(["score", "route", "plan"]):
        b.append(rect(316 + i * 74, 362, 66, 26, "chipbg", 13))
        b.append(t(349 + i * 74, 379, name, "", "middle"))
    box(648, 298, 292, 48, "GitHub issues", "create · re-prioritize · nudge · close")
    box(648, 370, 292, 48, "CI gate", "red while P1/P2 findings are overdue")

    for i, path in enumerate(["M210,320 C250,320 260,350 298,350 H548 C600,350 600,322 648,322",
                              "M210,364 H548 C600,350 600,322 648,322",
                              "M210,405 C250,405 260,378 298,378 H548 C600,378 600,394 648,394"]):
        b.append(f'<circle r="4.5" class="packet okbg"><animateMotion dur="4.5s" begin="{i * 1.5:.1f}s" '
                 f'repeatCount="indefinite" path="{path}"/></circle>')

    body = "\n".join(b)
    # Before its begin time a moving packet would sit at (0,0): keep it hidden until then.
    body = re.sub(r'<circle (r="[^"]+" class="packet[^"]*")>(\s*)<animateMotion([^>]*?)begin="([^"]+)"',
                  r'<circle \1 visibility="hidden"><set attributeName="visibility" to="visible" begin="\4"/>'
                  r'<animateMotion\3begin="\4"', body)
    return svg(W, H, "Falcon architecture",
               "Detect lane: Cloud Audit Logs flow through a log sink and Pub/Sub into a Go pipeline on Cloud Run, "
               "which normalizes events, runs YAML detection rules, writes to BigQuery and sends matches to Slack; "
               "malformed messages go to a dead-letter topic. Triage lane: Dependabot and code-scanning alerts, "
               "EPSS and CISA KEV intel and CODEOWNERS feed a TypeScript triager that manages GitHub issues and a CI gate.",
               body, ".packet{}")


# --------------------------------------------------------------------------
# Shared 3x2 storyboard layout.
# --------------------------------------------------------------------------
COLS = [16, 331, 646]
ROWS = [58, 290]
CW, CH = 298, 210


def connectors(tl, starts):
    out = []
    for i in range(2):  # within each row
        for row in range(2):
            idx = row * 3 + i + 1
            if idx >= len(starts):
                continue
            x = COLS[i] + CW + 3
            y = ROWS[row] + CH / 2
            cls = tl.show(starts[idx] - 0.3, "opacity:.25", "opacity:1")
            out.append(f'<path d="M{x},{y} H{x + 11}" class="flow {cls}" marker-end="url(#arrow)"/>')
    return out


def row_turn(tl, start, x_from, x_to):
    cls = tl.show(start - 0.3, "opacity:.25", "opacity:1")
    y1, y2 = ROWS[0] + CH, ROWS[1]
    return (f'<path d="M{x_from},{y1 + 2} C{x_from},{y1 + 16} {x_to},{y2 - 16} {x_to},{y2 - 3}" '
            f'class="flow dash {cls}" marker-end="url(#arrow)"/>')


def check(tl, x, y, at, ok=True):
    cls = tl.show(at, "opacity:0;transform:scale(.4)", "opacity:1;transform:scale(1)", 0.25)
    glyph, color = ("✓", "ok") if ok else ("✗", "alert")
    return (f'<g class="{cls}" style="transform-box:fill-box;transform-origin:center">'
            f'{t(x, y, glyph, color + " b", extra=BIG)}</g>')


# --------------------------------------------------------------------------
# 2. Detection: one attack step, end to end.
# --------------------------------------------------------------------------
def detection():
    W, H = 960, 520
    total = 16.0
    tl = Timeline(total, 15.0)
    S = [0.4, 2.8, 5.2, 7.6, 10.0, 12.2]
    end = [S[1], S[2], S[3], S[4], S[5], 15.0]
    b = [t(24, 34, "How Falcon catches one attack step", "h1"),
         t(W - 24, 34, "replay locally: make up && make attack", "sub mono", "end")]
    b += connectors(tl, S[:5])
    b.append(row_turn(tl, S[3], COLS[2] + CW / 2, COLS[0] + CW / 2))

    def at(i, d):
        return S[i] + d

    # 1. Attacker
    x, y = COLS[0], ROWS[0]
    b.append(grid_card(tl, x, y, CW, CH, 1, "An attacker acts", S[0], end[0]))
    b.append(rect(x + 14, y + 44, CW - 28, 92, "code", 6))
    lines = ["$ gcloud iam service-accounts keys \\", "    create key.json \\",
             "    --iam-account ci-deployer@prod..."]
    for i, line in enumerate(lines):
        b.append(f'<g class="{tl.show(at(0, 0.3 + i * 0.45))}">{t(x + 24, y + 70 + i * 20, line, "mono")}</g>')
    b.append(f'<g class="{tl.show(at(0, 1.6))}">{t(x + 24, y + 125, "Created key [3f9a...] ✓", "mono ok")}</g>')
    b.append(t(x + 14, y + 162, "mallory@corp.example", "b"))
    b.append(t(x + 14, y + 180, "phished session · from 203.0.113.66", "sub"))
    b.append(t(x + 14, y + 196, "goal: a key that survives a password reset", "sub"))
    b.append("</g>")

    # 2. Audit log
    x, y = COLS[1], ROWS[0]
    b.append(grid_card(tl, x, y, CW, CH, 2, "GCP writes an audit log", S[1], end[1]))
    b.append(rect(x + 14, y + 44, CW - 28, 124, "code", 6))
    json_lines = [('"methodName":', "muted"), ('  "...CreateServiceAccountKey",', ""),
                  ('"authenticationInfo": {', "muted"),
                  ('  "principalEmail":', ""),
                  ('    "mallory@corp.example" },', ""),
                  ('"requestMetadata": {', "muted"),
                  ('  "callerIp": "203.0.113.66" }', "")]
    for i, (line, cls) in enumerate(json_lines):
        b.append(f'<g class="{tl.show(at(1, 0.2 + i * 0.22))}">'
                 f'{t(x + 22, y + 62 + i * 16, line, ("mono " + cls).strip())}</g>')
    b.append(t(x + 14, y + 188, "Log sink → Pub/Sub → push to pipeline", "sub"))
    b.append(t(x + 14, y + 203, "a dead-letter topic catches anything that fails", "sub"))
    dot = tl.window(at(1, 1.6), at(1, 2.3), "opacity:0", "opacity:1")
    b.append(f'<circle cx="{x + CW - 22}" cy="{y + 22}" r="5" class="accentbg {dot}"/>')
    b.append("</g>")

    # 3. Normalize + enrich
    x, y = COLS[2], ROWS[0]
    b.append(grid_card(tl, x, y, CW, CH, 3, "Normalize + enrich", S[2], end[2]))
    rows = [("action", "...CreateServiceAccountKey", False), ("actor", "mallory@corp.example", False),
            ("actor_type", "user", True), ("ip_class", "public", True), ("outcome", "success", False),
            ("project", "falcon-demo-prod", False)]
    for i, (k, v, enriched) in enumerate(rows):
        yy = y + 64 + i * 22
        g = tl.show(at(2, 0.2 + i * 0.25))
        tag = ""
        if enriched:
            tag = rect(x + CW - 82, yy - 13, 66, 18, "chipbg", 9) + t(x + CW - 49, yy, "enriched", "sub", "middle")
        b.append(f'<g class="{g}">{t(x + 16, yy, k, "mono muted")}{t(x + 104, yy, v, "mono")}{tag}</g>')
    b.append(t(x + 16, y + 200, "one flat schema for every source", "sub"))
    b.append("</g>")

    # 4. Rule matches
    x, y = COLS[0], ROWS[1]
    b.append(grid_card(tl, x, y, CW, CH, 4, "A detection rule matches", S[3], end[3]))
    b.append(rect(x + 14, y + 44, CW - 28, 124, "code", 6))
    yaml = ["id: gcp-sa-key-created", "severity: high   mitre: T1098.001", "match:", "  all:",
            "  - action = CreateServiceAccountKey", "  - outcome = success"]
    for i, line in enumerate(yaml):
        cls = "mono accent" if i == 0 else "mono"
        b.append(t(x + 22, y + 64 + i * 19, line, cls))
    b.append(check(tl, x + CW - 30, y + 140, at(3, 0.5)))
    b.append(check(tl, x + CW - 30, y + 159, at(3, 0.9)))
    stamp = tl.show(at(3, 1.4), "opacity:0;transform:scale(1.6) rotate(-8deg)", "opacity:1;transform:scale(1) rotate(-8deg)", 0.25)
    b.append(f'<g class="{stamp}" style="transform-box:fill-box;transform-origin:center">'
             f'{rect(x + 170, y + 94, 84, 30, "alertbg", 5)}{t(x + 212, y + 114, "MATCH", "b", "middle", WHITE)}</g>')
    b.append(t(x + 14, y + 190, "7 rules, 30 fixtures, all run in CI", "sub"))
    b.append(t(x + 14, y + 205, "and in the Docker build", "sub"))
    b.append("</g>")

    # 5. Alert
    x, y = COLS[1], ROWS[1]
    b.append(grid_card(tl, x, y, CW, CH, 5, "A human is alerted", S[4], end[4]))
    slack = tl.show(at(4, 0.3), "opacity:0;transform:translateY(10px)", "opacity:1;transform:translateY(0)", 0.4)
    b.append(f'<g class="{slack}">')
    b.append(rect(x + 14, y + 44, CW - 28, 116, "code", 6))
    b.append(rect(x + 14, y + 44, 4, 116, "alertbg", 2))
    b.append(f'<circle cx="{x + 32}" cy="{y + 64}" r="6" class="alertbg"/>')
    b.append(t(x + 44, y + 68, "Service account key created", "b"))
    b.append(t(x + 28, y + 90, "gcp-sa-key-created · HIGH · T1098.001", "mono"))
    b.append(t(x + 28, y + 110, "Actor:   mallory@corp.example", "mono"))
    b.append(t(x + 28, y + 128, "Project: falcon-demo-prod", "mono"))
    b.append(t(x + 28, y + 146, "Runbook: docs/runbooks.md", "mono accent"))
    b.append("</g>")
    bq = tl.show(at(4, 1.2))
    b.append(f'<g class="{bq}">{t(x + 14, y + 184, "+1 row in falcon_security.alerts", "sub")}'
             f'{t(x + 14, y + 200, "to query and graph in BigQuery", "sub")}</g>')
    b.append("</g>")

    # 6. Near miss
    x, y = COLS[2], ROWS[1]
    b.append(grid_card(tl, x, y, CW, CH, 6, "Meanwhile, a near miss", S[5], end[5], dashed=True))
    b.append(t(x + 16, y + 56, "bob@corp.example tries the same call", ""))
    b.append(rect(x + 14, y + 66, CW - 28, 62, "code", 6))
    b.append(t(x + 22, y + 86, "status: 7 PERMISSION_DENIED", "mono"))
    b.append(t(x + 22, y + 104, "outcome = failure", "mono"))
    b.append(t(x + 22, y + 122, "- outcome = success", "mono"))
    b.append(check(tl, x + CW - 32, y + 122, S[5] + 0.6, ok=False))
    quiet = tl.show(S[5] + 1.1)
    b.append(f'<g class="{quiet}">{t(x + 16, y + 154, "No alert: denied calls are not compromises.", "b ok")}'
             f'{t(x + 16, y + 172, "The event is still stored for hunting.", "sub")}'
             f'{t(x + 16, y + 190, "The demo checks 40 of these: 0 false alarms.", "sub")}</g>')
    b.append("</g>")

    return svg(W, H, "How Falcon detects an attack",
               "Six steps: an attacker creates a service account key; GCP writes an audit log; the pipeline "
               "normalizes and enriches it; the gcp-sa-key-created rule matches; a Slack alert is sent and a row is "
               "written to BigQuery. A denied attempt by another user does not alert.",
               "\n".join(b), tl.style())


# --------------------------------------------------------------------------
# 3. Triage: life of a vulnerability.
# --------------------------------------------------------------------------
def triage():
    W, H = 960, 520
    total = 18.0
    tl = Timeline(total, 17.0)
    S = [0.4, 3.0, 5.6, 8.2, 10.8, 13.6]
    end = [S[1], S[2], S[3], S[4], S[5], 17.0]
    b = [t(24, 34, "Life of a vulnerability", "h1"),
         t(W - 24, 34, "replay locally: make triage-demo", "sub mono", "end")]
    b += connectors(tl, S)
    b.append(row_turn(tl, S[3], COLS[2] + CW / 2, COLS[0] + CW / 2))

    def at(i, d):
        return S[i] + d

    # 1. Alert
    x, y = COLS[0], ROWS[0]
    b.append(grid_card(tl, x, y, CW, CH, 1, "Dependabot raises an alert", S[0], end[0]))
    pop = tl.show(at(0, 0.3), "opacity:0;transform:translateY(10px)", "opacity:1;transform:translateY(0)", 0.4)
    b.append(f'<g class="{pop}">{rect(x + 14, y + 44, CW - 28, 98, "code", 6)}'
             f'{rect(x + 24, y + 56, 58, 20, "alertbg", 10)}{t(x + 53, y + 70, "critical", "b", "middle", WHITE)}'
             f'{t(x + 90, y + 70, "CVE-2021-44228", "mono b")}'
             f'{t(x + 24, y + 96, "org.apache.logging.log4j:log4j-core", "mono")}'
             f'{t(x + 24, y + 114, "services/ledger/pom.xml", "mono muted")}'
             f'{t(x + 24, y + 132, "maven · runtime dependency", "mono muted")}</g>')
    b.append(t(x + 14, y + 170, "Dependabot and code scanning, across", "sub"))
    b.append(t(x + 14, y + 186, "npm, Maven, Go and Python repos", "sub"))
    b.append("</g>")

    # 2. Score
    x, y = COLS[1], ROWS[0]
    b.append(grid_card(tl, x, y, CW, CH, 2, "Score real-world risk", S[1], end[1]))
    bars = [("CVSS 10.0", 40, "accentbg"), ("EPSS 94%", 28, "warnbg"), ("CISA KEV", 30, "alertbg")]
    for i, (label, pts, cls) in enumerate(bars):
        yy = y + 58 + i * 30
        b.append(t(x + 16, yy + 12, label, "mono"))
        b.append(rect(x + 96, yy, 140, 16, "mutedbg", 4))
        grow = tl.show(at(1, 0.3 + i * 0.5), "transform:scaleX(0)", "transform:scaleX(1)", 0.45)
        b.append(rect(x + 96, yy, pts / 40 * 140, 16, f"{cls} bar {grow}", 4))
        b.append(f'<g class="{tl.show(at(1, 0.7 + i * 0.5))}">{t(x + 244, yy + 12, f"+{pts}", "mono b")}</g>')
    total_g = tl.show(at(1, 1.9), "opacity:0;transform:scale(1.5)", "opacity:1;transform:scale(1)", 0.3)
    b.append(f'<g class="{total_g}" style="transform-box:fill-box;transform-origin:center">'
             f'{t(x + 16, y + 168, "98 / 100", "h1")}'
             f'{rect(x + 96, y + 152, 40, 22, "alertbg", 11)}{t(x + 116, y + 168, "P1", "b", "middle", WHITE)}'
             f'{t(x + 146, y + 168, "fix within 7 days", "sub")}</g>')
    b.append(t(x + 16, y + 196, "every point is explained in the issue", "sub"))
    b.append("</g>")

    # 3. Route
    x, y = COLS[2], ROWS[0]
    b.append(grid_card(tl, x, y, CW, CH, 3, "Route to the owning team", S[2], end[2]))
    b.append(rect(x + 14, y + 44, CW - 28, 96, "code", 6))
    hl = tl.show(at(2, 0.9), "opacity:0", "opacity:1")
    b.append(rect(x + 16, y + 112, CW - 32, 20, f"chipbg {hl}", 3))
    co = [("*                    @acme/platform", "mono muted"),
          ("/services/checkout/  @acme/checkout-team", "mono muted"),
          ("/services/ledger/    @acme/ledger-team", "mono")]
    for i, (line, cls) in enumerate(co):
        b.append(t(x + 22, y + 86 + i * 20, line, cls))
    b.append(t(x + 22, y + 62, "CODEOWNERS", "sub"))
    owner = tl.show(at(2, 1.4), "opacity:0;transform:translateY(8px)", "opacity:1;transform:translateY(0)")
    b.append(f'<g class="{owner}">{t(x + 16, y + 166, "→", "b accent")}'
             f'{rect(x + 34, y + 152, 140, 22, "chipbg", 11)}{t(x + 104, y + 168, "@acme/ledger-team", "b", "middle")}'
             f'{t(x + 16, y + 198, "last match wins, like GitHub itself", "sub")}</g>')
    b.append("</g>")

    # 4. Issue opened, SLA clock
    x, y = COLS[0], ROWS[1]
    b.append(grid_card(tl, x, y, CW, CH, 4, "Open an issue, start the clock", S[3], end[3]))
    b.append(rect(x + 14, y + 44, CW - 28, 92, "code", 6))
    b.append(f'<circle cx="{x + 30}" cy="{y + 62}" r="6" class="okbg"/>')
    b.append(t(x + 42, y + 66, "[P1] log4j-core: Remote code", "b"))
    b.append(t(x + 42, y + 82, "injection (CVE-2021-44228)", "b"))
    for i, (lab, w_) in enumerate([("falcon", 50), ("falcon:P1", 70), ("ecosystem:maven", 108)]):
        lx = x + 26 + [0, 56, 132][i]
        b.append(rect(lx, y + 94, w_, 18, "chipbg", 9) + t(lx + w_ / 2, y + 107, lab, "sub", "middle"))
    b.append(t(x + 26, y + 128, "@acme/ledger-team · due in 7 days", "sub"))
    b.append(t(x + 16, y + 158, "SLA", "sub"))
    b.append(rect(x + 46, y + 148, 236, 14, "mutedbg", 7))
    sla = tl.show(at(3, 0.4), "transform:scaleX(0)", "transform:scaleX(.85)", 2.0)
    b.append(rect(x + 46, y + 148, 236, 14, f"warnbg bar {sla}", 7))
    b.append(t(x + 16, y + 192, "re-runs are idempotent: state is kept in", "sub"))
    b.append(t(x + 16, y + 207, "hidden markers in the issue body", "sub"))
    b.append("</g>")

    # 5. Overdue: nudge + gate
    x, y = COLS[1], ROWS[1]
    b.append(grid_card(tl, x, y, CW, CH, 5, "Overdue? Nudge and gate", S[4], end[4]))
    b.append(t(x + 16, y + 58, "SLA", "sub"))
    b.append(rect(x + 46, y + 48, 236, 14, "alertbg", 7))
    b.append(t(x + 282, y + 78, "3 days overdue", "sub alert", "end"))
    bubble = tl.show(at(4, 0.4), "opacity:0;transform:translateY(8px)", "opacity:1;transform:translateY(0)")
    b.append(f'<g class="{bubble}">{rect(x + 14, y + 86, CW - 28, 52, "code", 6)}'
             f'{t(x + 24, y + 106, "@acme/ledger-team this P1 is 3 days", "")}'
             f'{t(x + 24, y + 124, "past its SLA. Please fix or dismiss.", "")}</g>')
    gate = tl.show(at(4, 1.2), "opacity:0", "opacity:1")
    b.append(f'<g class="{gate}">{rect(x + 14, y + 150, CW - 28, 30, "code", 6)}'
             f'{t(x + 26, y + 170, "✗", "alert b", extra=BIG)}'
             f'{t(x + 44, y + 170, "falcon-triage check: 1 P1 overdue", "mono")}</g>')
    b.append(t(x + 16, y + 200, "nudges are rate-limited: once a week", "sub"))
    b.append("</g>")

    # 6. Fixed: closed
    x, y = COLS[2], ROWS[1]
    b.append(grid_card(tl, x, y, CW, CH, 6, "Fixed? Close it automatically", S[5], end[5]))
    b.append(rect(x + 14, y + 44, CW - 28, 44, "code", 6))
    b.append(t(x + 24, y + 62, "Dependabot alert #14", "mono"))
    st = tl.show(at(5, 0.3), "opacity:0", "opacity:1")
    b.append(f'<g class="{st}">{rect(x + 24, y + 68, 56, 16, "okbg", 8)}'
             f'{t(x + 52, y + 80, "fixed", "b", "middle", WHITE11)}'
             f'{t(x + 88, y + 80, "log4j-core upgraded", "sub")}</g>')
    closed = tl.show(at(5, 0.9), "opacity:0;transform:translateY(8px)", "opacity:1;transform:translateY(0)")
    b.append(f'<g class="{closed}">{rect(x + 14, y + 98, CW - 28, 40, "code", 6)}'
             f'{rect(x + 24, y + 109, 62, 18, "accentbg", 9)}{t(x + 55, y + 122, "Closed", "b", "middle", WHITE11)}'
             f'{t(x + 94, y + 122, "Resolved: alert is fixed.", "")}</g>')
    ok = tl.show(at(5, 1.5), "opacity:0", "opacity:1")
    b.append(f'<g class="{ok}">{rect(x + 14, y + 148, CW - 28, 30, "code", 6)}'
             f'{t(x + 26, y + 168, "✓", "ok b", extra=BIG)}'
             f'{t(x + 44, y + 168, "falcon-triage check: PASS", "mono")}</g>')
    b.append(t(x + 16, y + 200, "closed by hand while still open? reopened", "sub"))
    b.append("</g>")

    return svg(W, H, "Life of a vulnerability in Falcon",
               "Six steps: Dependabot raises a critical Log4j alert; Falcon scores it 98 out of 100 (CVSS, EPSS and "
               "CISA KEV) as P1; CODEOWNERS routes it to the ledger team; an issue opens with a 7-day SLA; when "
               "overdue the owners are nudged and the CI gate fails; once fixed the issue closes and the gate passes.",
               "\n".join(b), tl.style())


# --------------------------------------------------------------------------
# 4. Attackers: who they are, what they run, what Falcon raises.
# --------------------------------------------------------------------------
ATTACKERS = [
    dict(tab="External attacker", tab_sub="phished an engineer's login", initials="EX", bg="alertbg",
         who="mallory@corp.example", got_in="a phished session, from 203.0.113.66",
         goal="a backdoor that survives a password reset",
         cmd=["$ gcloud projects add-iam-policy-binding \\", "    falcon-demo-prod --role=roles/owner \\",
              "    --member=user:helpdesk.backup@gmail.com"],
         out="Updated IAM policy for project ✓",
         log=["methodName: ...SetIamPolicy", "iam_deltas: ADD roles/owner"],
         sev="HIGH", sev_bg="warnbg", title="Privileged IAM role granted", rule="gcp-privileged-role-granted",
         mitre="T1098.003", detail="roles/owner → helpdesk.backup@gmail…",
         runbook="remove the binding, review the actor"),
    dict(tab="Malicious insider", tab_sub="real access, bad intent", initials="IN", bg="alertbg",
         who="dave@corp.example", got_in="no break-in: a legitimate employee",
         goal="walk out with customer data",
         cmd=["$ gsutil iam ch allUsers:objectViewer \\", "    gs://acme-customer-exports"],
         out="Updated IAM policy ✓",
         log=["methodName: storage.setIamPermissions", "iam_deltas: ADD allUsers"],
         sev="CRITICAL", sev_bg="alertbg", title="Cloud Storage bucket made public", rule="gcp-bucket-made-public",
         mitre="T1530", detail="allUsers → acme-customer-exports",
         runbook="treat as a data exposure"),
    dict(tab="Hijacked CI pipeline", tab_sub="poisoned dependency in the build", initials="CI", bg="alertbg",
         who="ci-deployer@…iam.gserviceaccount.com", who_short="ci-deployer service account", got_in="a malicious package stole the CI token",
         goal="hide everything it does next",
         cmd=["$ gcloud logging sinks update \\", "    falcon-audit-sink \\", "    --add-exclusion=name=quiet,\\",
              "    filter='...principalEmail:ci-deployer'"],
         out="Updated [falcon-audit-sink] ✓",
         log=["methodName: ...ConfigServiceV2.UpdateSink", "outcome: success"],
         sev="CRITICAL", sev_bg="alertbg", title="Audit logging tampered with", rule="gcp-audit-logging-tampered",
         mitre="T1562.008", detail="sink falcon-audit-sink changed",
         runbook="restore the sink from Terraform"),
    dict(tab="Careless engineer", tab_sub="no bad intent, same risk", initials="EN", bg="warnbg",
         who="sam@corp.example", got_in="their own account, at 23:40",
         goal="\"just SSH in from home\" to debug",
         cmd=["$ gcloud compute firewall-rules create \\", "    debug-ssh --allow=tcp:22 \\",
              "    --source-ranges=0.0.0.0/0"],
         out="Created [debug-ssh] ✓",
         log=["methodName: v1.compute.firewalls.insert", "sourceRanges: 0.0.0.0/0"],
         sev="HIGH", sev_bg="warnbg", title="Firewall rule opened to the internet",
         rule="gcp-firewall-open-to-internet", mitre="T1562.007", detail="tcp:22 open to 0.0.0.0/0",
         runbook="delete or narrow the rule"),
]


def attackers():
    W, H = 960, 470
    scene = 5.0
    n = len(ATTACKERS)
    tl = Timeline(scene * n, scene * n)
    b = [t(24, 34, "Who attacks a cloud account, and how Falcon catches each one", "h1"),
         t(W - 24, 34, "4 scenarios, one every 5 s", "sub", "end")]

    # Persona tabs: the one being played is outlined.
    tw = (W - 32 - 3 * 12) / 4
    for i, a in enumerate(ATTACKERS):
        x = 16 + i * (tw + 12)
        s = i * scene
        on = "stroke:var(--alert);stroke-width:2.4"
        cls = tl.window(s, s + scene - 0.3, "stroke:var(--line);stroke-width:1.2", on)
        base = f' style="{on}"' if i == n - 1 else ""
        b.append(rect(x, 50, tw, 42, f"card {cls}", 8, base))
        b.append(f'<circle cx="{x + 20}" cy="71" r="11" class="{a["bg"]}"/>')
        b.append(t(x + 20, 75, a["initials"], "numt", "middle"))
        b.append(t(x + 38, 67, a["tab"], "b"))
        b.append(t(x + 38, 83, a["tab_sub"], "sub"))

    # Three panels.
    P = [(16, 270), (302, 356), (674, 270)]
    PY, PH = 108, 222
    heads = ["1 · Who, and why", "2 · What they run", "3 · What Falcon raises"]
    for (x, w), head in zip(P, heads):
        b.append(rect(x, PY, w, PH, "card", 10))
        b.append(t(x + 14, PY + 24, head, "ct"))
    for (x, w), (nx, _) in zip(P, P[1:]):
        b.append(f'<path d="M{x + w + 3},{PY + PH / 2} H{nx - 3}" class="flow" marker-end="url(#arrow)"/>')
    cx, cw = P[2]
    b.append(t(cx + cw / 2, PY + 120, "watching the audit stream…", "sub", "middle"))

    for i, a in enumerate(ATTACKERS):
        s = i * scene
        stop = s + scene - 0.3
        hidden = ' style="opacity:0"' if i < n - 1 else ""
        b.append(f'<g class="{tl.window(s, stop, "opacity:0", "opacity:1")}"{hidden}>')

        def later(d, frm="opacity:0", to="opacity:1"):
            return tl.window(s + d, stop, frm, to)

        # Who
        x, w = P[0]
        y = PY
        b.append(f'<circle cx="{x + 38}" cy="{y + 66}" r="22" class="{a["bg"]}"/>')
        b.append(t(x + 38, y + 71, a["initials"], "b", "middle", ' style="fill:#fff;font-size:14px"'))
        b.append(t(x + 70, y + 62, a["tab"], "b"))
        b.append(t(x + 70, y + 80, a.get("who_short", a["who"]), "sub mono"))
        b.append(t(x + 14, y + 122, "How they got in", "sub"))
        b.append(t(x + 14, y + 140, a["got_in"]))
        b.append(t(x + 14, y + 170, "Goal", "sub"))
        b.append(t(x + 14, y + 188, a["goal"], "b"))

        # What they run
        x, w = P[1]
        b.append(rect(x + 14, y + 38, w - 28, 98, "code", 6))
        for j, line in enumerate(a["cmd"]):
            b.append(f'<g class="{later(0.3 + j * 0.3)}">{t(x + 22, y + 58 + j * 17, line, "mono")}</g>')
        b.append(f'<g class="{later(1.5)}">{t(x + 22, y + 128, a["out"], "mono ok")}</g>')
        b.append(f'<g class="{later(1.8)}">{t(x + 14, y + 160, "GCP writes it to Cloud Audit Logs", "sub")}'
                 f'{rect(x + 14, y + 168, w - 28, 44, "code", 6)}'
                 f'{t(x + 22, y + 186, a["log"][0], "mono")}{t(x + 22, y + 203, a["log"][1], "mono")}</g>')

        # What Falcon raises
        x, w = P[2]
        pop = later(3.2, "opacity:0;transform:translateY(10px)", "opacity:1;transform:translateY(0)")
        b.append(f'<g class="{pop}">{rect(x + 10, y + 36, w - 20, 178, "card", 6)}'
                 f'{rect(x + 10, y + 36, 4, 178, "alertbg", 2)}')
        pill_w = 66 if a["sev"] == "CRITICAL" else 42
        b.append(rect(x + 24, y + 48, pill_w, 18, a["sev_bg"], 9))
        b.append(t(x + 24 + pill_w / 2, y + 61, a["sev"], "b", "middle", WHITE11))
        b.append(t(x + 32 + pill_w, y + 61, a["mitre"], "mono muted"))
        b.append(t(x + 24, y + 88, a["title"], "b"))
        b.append(t(x + 24, y + 106, a["rule"], "mono accent"))
        b.append(t(x + 24, y + 132, "Actor", "sub"))
        b.append(t(x + 24, y + 148, a["who"], "mono"))
        b.append(t(x + 24, y + 170, a["detail"], "mono"))
        b.append(t(x + 24, y + 196, "Runbook: " + a["runbook"], "sub"))
        b.append("</g>")
        b.append("</g>")

    # Falcon's side, replayed in every scene.
    b.append(t(24, 362, "Inside Falcon, a few seconds later", "ct"))
    chips = ["Cloud Audit Log", "Pub/Sub push", "normalize + enrich", "detect", "Slack + BigQuery"]
    cw_, gap = 160, 32
    for i, name in enumerate(chips):
        x = 16 + i * (cw_ + gap)
        if i:
            b.append(f'<path d="M{x - gap + 3},392 H{x - 3}" class="flow" marker-end="url(#arrow)"/>')
        b.append(rect(x, 376, cw_, 32, "chipbg", 16))
        b.append(t(x + cw_ / 2, 396, name, "b" if name == "detect" else "", "middle"))
    dx = 16 + 3 * (cw_ + gap)
    b.append(f'<rect x="{dx}" y="376" width="{cw_}" height="32" rx="16" class="packet alertbg" opacity="0">'
             f'<animate attributeName="opacity" dur="{scene}s" repeatCount="indefinite" calcMode="discrete" '
             f'values="0;1;0" keyTimes="0;0.55;0.66"/></rect>')
    b.append(f'<text x="{dx + cw_ / 2}" y="396" text-anchor="middle" class="packet" opacity="0" '
             f'style="fill:#fff;font-weight:600">MATCH<animate attributeName="opacity" dur="{scene}s" '
             f'repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;0.55;0.66"/></text>')
    b.append(f'<circle r="6" class="packet alertbg" opacity="0">'
             f'<animateMotion dur="{scene}s" repeatCount="indefinite" path="M96,392 H864" '
             f'keyPoints="0;0;1;1" keyTimes="0;0.36;0.64;1" calcMode="linear"/>'
             f'<animate attributeName="opacity" dur="{scene}s" repeatCount="indefinite" calcMode="discrete" '
             f'values="0;1;0" keyTimes="0;0.36;0.64"/></circle>')
    for i, a in enumerate(ATTACKERS):
        s = i * scene
        hidden = ' style="opacity:0"' if i < n - 1 else ""
        b.append(f'<g class="{tl.window(s + 2.6, s + scene - 0.3, "opacity:0", "opacity:1")}"{hidden}>'
                 f'{t(dx + cw_ / 2, 426, "rule: " + a["rule"], "mono accent", "middle")}</g>')
    b.append(t(24, 452, "None of them uses malware. They call ordinary Google APIs, and every call lands in "
               "Cloud Audit Logs, which is exactly what Falcon reads.", "sub"))

    return svg(W, H, "Who attacks a cloud account, and how Falcon catches each one",
               "Four scenarios play in turn. An external attacker with a phished login grants roles/owner to a "
               "Gmail account and Falcon raises gcp-privileged-role-granted. A malicious insider makes the customer "
               "exports bucket public: gcp-bucket-made-public. A CI pipeline hijacked by a poisoned dependency adds "
               "an exclusion to the audit log sink to hide itself: gcp-audit-logging-tampered. A careless engineer "
               "opens SSH to 0.0.0.0/0: gcp-firewall-open-to-internet. Each time the audit event flows through "
               "Pub/Sub, normalize and detect to Slack and BigQuery.",
               "\n".join(b), tl.style())


os.makedirs(OUT, exist_ok=True)
for name, fn in [("architecture", architecture), ("detection-flow", detection), ("vulnerability-lifecycle", triage),
                 ("attacker-scenarios", attackers)]:
    with open(os.path.join(OUT, f"{name}.svg"), "w") as f:
        f.write(fn())
    print("wrote", name)
