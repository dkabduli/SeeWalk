"""Draw the home-screen icons: a white cane (grip, white shaft, red tip) tapping the ground, on the app's near-black.

    server/.venv/bin/python web/scripts/make_icons.py            # writes web/public/icons/*.png
    server/.venv/bin/python web/scripts/make_icons.py --preview  # also a contact sheet to look at

Same colours as the app (walk.css). Everything stays inside the centre circle Android keeps when it
crops a "maskable" icon, so one drawing serves iPhone, Android and the browser tab.
Needs Pillow (already in the server venv).
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

BG = (15, 17, 19)        # --bg  #0f1113
WHITE = (244, 242, 237)  # --text #f4f2ed (the app's white, softer than pure #fff)
RED = (224, 54, 44)      # --red #e0362c, the cane tip
S = 4096                 # drawn big, scaled down: smooth edges

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"

# The cane in a 0..1 square, from the grip (top right) to the tip on the ground (bottom left).
# A real white cane: black rubber grip, white shaft, red band at the bottom, flat tip.
TOP, BOTTOM = (0.720, 0.225), (0.435, 0.730)
WIDTH = 0.074            # shaft thickness
GRIP = 0.17              # share of the length that is grip
TIP = 0.22               # share of the length that is red
GRIP_COLOUR = (125, 142, 163)   # --steel: a dark grip would vanish on the dark background
# Where the tip touches the ground: flat ripples, like a tap on pavement (rx, ry, thickness)
RIPPLES = [(0.120, 0.038, 0.015), (0.210, 0.066, 0.013)]
RIPPLE_COLOURS = [WHITE, (125, 142, 163)]


def draw(ripples: bool) -> Image.Image:
    img = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(img)
    (x1, y1), (x2, y2) = TOP, BOTTOM
    at = lambda f: (x1 + (x2 - x1) * f, y1 + (y2 - y1) * f)  # noqa: E731  0 = grip end, 1 = tip
    w = WIDTH * S
    # unit vectors along and across the shaft
    L = math.hypot(x2 - x1, y2 - y1)
    ux, uy = (x2 - x1) / L, (y2 - y1) / L
    nx, ny = -uy, ux

    def segment(f0, f1, colour):  # a straight piece of shaft with square ends
        (ax, ay), (bx, by) = at(f0), at(f1)
        h = w / 2
        pts = [(ax * S + nx * h, ay * S + ny * h), (bx * S + nx * h, by * S + ny * h),
               (bx * S - nx * h, by * S - ny * h), (ax * S - nx * h, ay * S - ny * h)]
        d.polygon(pts, fill=colour)

    if ripples:
        cx, cy = BOTTOM[0] * S, (BOTTOM[1] + 0.012) * S
        for (rx, ry, t), colour in zip(reversed(RIPPLES), reversed(RIPPLE_COLOURS)):
            d.ellipse([cx - rx * S, cy - ry * S, cx + rx * S, cy + ry * S], outline=colour, width=int(t * S))
    segment(0, GRIP, GRIP_COLOUR)
    segment(GRIP, 1 - TIP, WHITE)
    segment(1 - TIP, 1, RED)
    r = w / 2  # the grip's rounded top
    gx, gy = TOP[0] * S, TOP[1] * S
    d.ellipse([gx - r, gy - r, gx + r, gy + r], fill=GRIP_COLOUR)
    return img


def save(img: Image.Image, name: str, size: int):
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    icon = draw(ripples=True)
    save(icon, "apple-touch-icon.png", 180)   # iPhone home screen
    save(icon, "icon-192.png", 192)           # Android / install
    save(icon, "icon-512.png", 512)
    save(icon, "icon-maskable-512.png", 512)  # already inside the safe circle
    save(draw(ripples=False), "favicon-32.png", 32)  # ripples turn to mush this small
    print("wrote", ", ".join(sorted(f.name for f in OUT.glob("*.png"))))

    if "--preview" in sys.argv:  # both designs, full size, iPhone rounded square, Android circle, tiny
        sheet = Image.new("RGB", (1180, 640), (40, 44, 50))
        for row, rip in enumerate((False, True)):
            art = draw(rip)
            x = 20
            for size, shape in ((260, "square"), (260, "ios"), (260, "circle"), (60, "square"), (32, "square")):
                tile = art.resize((size, size), Image.LANCZOS)
                mask = Image.new("L", (size, size), 0)
                md = ImageDraw.Draw(mask)
                if shape == "circle":
                    md.ellipse([0, 0, size - 1, size - 1], fill=255)
                elif shape == "ios":
                    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.225), fill=255)
                else:
                    md.rectangle([0, 0, size, size], fill=255)
                sheet.paste(tile, (x, 20 + row * 310), mask)
                x += size + 30
        sheet.save(OUT.parent.parent / "icon-preview.png")
        print("preview: web/icon-preview.png")


if __name__ == "__main__":
    main()
