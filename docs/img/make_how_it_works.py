"""Draws docs/img/how-it-works.svg: who talks to whom in SeeWalk, with timings.

    python3 docs/img/make_how_it_works.py

Edit the MESSAGES list below and re-run when the flow changes.
"""
from html import escape
from pathlib import Path

W = 1360
BG, PANEL, LINE, TEXT, MUTED = "#0f1113", "#1a1d21", "#2e3238", "#f4f2ed", "#9aa3ad"
RED, AMBER, STEEL, PLANNED = "#e0362c", "#f3b21b", "#7d8ea3", "#5b626b"

# Lifelines: key → (x, name, detail, colour, planned?)
LANES = {
    "walker": (110, "Walker", "open-ear headphones", TEXT, False),
    "phone": (340, "iPhone (Safari)", "chest camera + mic", TEXT, False),
    "server": (570, "SeeWalk server", "FastAPI on the laptop", TEXT, False),
    "gemini": (800, "Gemini", "3.5 Flash-Lite", "#8ab4f8", False),
    "eleven": (1030, "ElevenLabs", "River voice", AMBER, False),
    "tiger": (1250, "Tiger Data", "not set up yet", PLANNED, True),
}

# Rows: ("section", number, title, planned?) | ("msg", from, to, label, style) | ("note", lane, text, width)
# style: "req" solid, "res" dashed, "out" = what the walker hears, "plan" = not built
ROWS = [
    ("section", "1", "Street alerts, automatic: a new snapshot every 0.8 s, up to 2 at Gemini at once", False),
    ("msg", "phone", "server", "POST /analyze · 768 px JPEG", "req"),
    ("msg", "server", "gemini", "image + prompt + JSON schema", "req"),
    ("msg", "gemini", "server", "hazards: type, left/ahead/right, distance · ~1.6 s", "res"),
    ("msg", "server", "phone", "SceneResult JSON", "res"),
    ("note", "phone", "Picks one: street hazards only · confidence ≥ 0.6 · first sighting, again under 2 m", 500),
    ("msg", "phone", "walker", "tone in L/R ear + “Stop sign on your right”", "out"),
    ("section", "2", "Ask a question: “SeeWalk, read this.” (also: what's ahead, what am I holding, what's blocking my path)", False),
    ("msg", "walker", "phone", "speech", "req"),
    ("msg", "phone", "server", "POST /listen · 16 kHz WAV + camera frame", "req"),
    ("msg", "server", "gemini", "audio + image in one call", "req"),
    ("msg", "gemini", "server", "heard · intent · answer · ~2 s", "res"),
    ("msg", "server", "phone", "answer text (wake word checked)", "res"),
    ("msg", "phone", "eleven", "POST /tts → Flash v2.5 (via the server)", "req"),
    ("msg", "eleven", "phone", "mp3 · ~0.3 s", "res"),
    ("msg", "phone", "walker", "the answer, in River's voice", "out"),
    ("section", "3", "Once, ahead of time", False),
    ("msg", "eleven", "phone", "Multilingual v2 → 148 River clips (EN + FR) bundled in the app: alerts play instantly", "res"),
    ("section", "4", "Planned, not built: hazard map", True),
    ("msg", "server", "tiger", "hazard + GPS + time → hypertable", "plan"),
    ("msg", "tiger", "phone", "map of reported potholes and curbs", "plan"),
]

HEAD_Y, HEAD_H = 92, 66
TOP = HEAD_Y + HEAD_H
out: list[str] = []
y = TOP + 30


def text(x, y, s, size=14, fill=TEXT, anchor="middle", weight=400):
    out.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{escape(s)}</text>')


body: list[str] = []
for row in ROWS:
    if row[0] == "section":
        _, num, title, planned = row
        y += 18
        col = PLANNED if planned else RED
        body.append(f'<rect x="24" y="{y - 22}" width="{W - 48}" height="34" rx="8" fill="{PANEL}" stroke="{LINE}"/>')
        body.append(f'<circle cx="48" cy="{y - 5}" r="11" fill="{col}"/>')
        body.append(f'<text x="48" y="{y - 0.5}" font-size="13" fill="{BG}" text-anchor="middle" font-weight="700">{num}</text>')
        body.append(f'<text x="68" y="{y}" font-size="15" fill="{MUTED if planned else TEXT}" font-weight="600">{escape(title)}</text>')
        y += 44
    elif row[0] == "note":
        _, lane, note, width = row
        x = LANES[lane][0]
        body.append(f'<rect x="{x - width / 2}" y="{y - 20}" width="{width}" height="30" rx="6" fill="{PANEL}" stroke="{STEEL}"/>')
        body.append(f'<text x="{x}" y="{y}" font-size="12" fill="{TEXT}" text-anchor="middle">{escape(note)}</text>')
        y += 42
    else:
        _, a, b, label, style = row
        x1, x2 = LANES[a][0], LANES[b][0]
        d = 1 if x2 > x1 else -1
        colour = {"req": TEXT, "res": STEEL, "out": AMBER, "plan": PLANNED}[style]
        dash = ' stroke-dasharray="6 5"' if style in ("res", "plan") else ""
        width = 3 if style == "out" else 1.8
        ex = x2 - d * 9
        body.append(f'<line x1="{x1 + d * 6}" y1="{y}" x2="{ex}" y2="{y}" stroke="{colour}" stroke-width="{width}"{dash}/>')
        body.append(f'<path d="M{x2 - d * 1},{y} L{ex - d * 4},{y - 6} L{ex - d * 4},{y + 6} Z" fill="{colour}"/>')
        mid = (x1 + x2) / 2
        lw = len(label) * 6.6 + 16
        body.append(f'<rect x="{mid - lw / 2}" y="{y - 24}" width="{lw}" height="18" fill="{BG}"/>')
        bold = ' font-weight="600"' if style == "out" else ""
        body.append(f'<text x="{mid}" y="{y - 10}" font-size="13" fill="{MUTED if style == "plan" else TEXT}" text-anchor="middle"{bold}>{escape(label)}</text>')
        y += 40

H = y + 64
# lifelines behind everything
for x, *_rest in LANES.values():
    planned = _rest[3]
    out.append(f'<line x1="{x}" y1="{TOP}" x2="{x}" y2="{H - 60}" stroke="{PLANNED if planned else LINE}" stroke-width="1.5" stroke-dasharray="3 6"/>')
out.extend(body)
# headers
for key, (x, name, detail, colour, planned) in LANES.items():
    dash = ' stroke-dasharray="6 5"' if planned else ""
    out.append(f'<rect x="{x - 96}" y="{HEAD_Y}" width="192" height="{HEAD_H}" rx="12" fill="{PANEL}" stroke="{colour}" stroke-width="2"{dash}/>')
    text(x, HEAD_Y + 29, name, 17, MUTED if planned else colour, weight=700)
    text(x, HEAD_Y + 50, detail, 13, MUTED)

# title + legend
text(24, 44, "How SeeWalk works", 28, TEXT, "start", 700)
text(24, 72, "The phone sees, Gemini understands, ElevenLabs speaks. Gemini and ElevenLabs times measured from our laptop, Sept 2026.", 14.5, MUTED, "start")
ly = H - 26
legend = [(TEXT, "", "request"), (STEEL, ' stroke-dasharray="6 5"', "response"), (AMBER, "", "what the walker hears"), (PLANNED, ' stroke-dasharray="6 5"', "planned, not built")]
lx = 24
for colour, dash, name in legend:
    w = 3 if colour == AMBER else 1.8
    out.append(f'<line x1="{lx}" y1="{ly - 5}" x2="{lx + 34}" y2="{ly - 5}" stroke="{colour}" stroke-width="{w}"{dash}/>')
    text(lx + 42, ly, name, 13, MUTED, "start")
    lx += 64 + len(name) * 6.6
text(W - 24, ly, "Hazard in view → heard: ~2 s (estimate)", 13, MUTED, "end")

svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
    'font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', Helvetica, Arial, sans-serif">'
    f'<title>How SeeWalk works: phone, server, Gemini, ElevenLabs, Tiger Data</title>'
    f'<rect width="{W}" height="{H}" rx="16" fill="{BG}"/>' + "".join(out) + "</svg>\n"
)
Path(__file__).with_name("how-it-works.svg").write_text(svg)
print(f"wrote how-it-works.svg ({W}x{H})")
