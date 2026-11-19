#!/usr/bin/env python3
"""Draws the diagrams for the REB-based courses and saves them next to each lesson as small .webp files.

    pip install --user Pillow
    python3 tools/make_pictures.py            # draw every picture
    python3 tools/make_pictures.py --list     # show each picture, its lesson and its description

A lesson shows a picture with a line like:   ![Two lines cross](crossing-lines.webp)
The words in the square brackets are read by screen readers, so they must say what the picture shows.
To change a picture, edit its function below and run this again. Then run tools/build_packs.py.
"""
import math, sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Install it first:  pip install --user Pillow")

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

W = 480    # drawing width in points. Phones show a picture about 330 points wide, so text must be large.
OUT = 2    # the saved file is twice that size, so it stays sharp
SS = 4     # drawn larger still, then shrunk, so lines are smooth

INK, NAVY, TEAL, ORANGE, GREY = "#1f2d3d", "#1f3a5f", "#1f8a70", "#e07b2a", "#7a8794"
PALE, PALE_T, PALE_O, LINE = "#eef3f8", "#dff3ec", "#fde9d6", "#c5d0db"

_fonts = {}

def font(size, bold=False):
    key = (size, bold)
    if key not in _fonts:
        names = ["arialbd.ttf", "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"] if bold else ["arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"]
        for name in names:
            try:
                _fonts[key] = ImageFont.truetype(name, size * SS)
                break
            except OSError:
                continue
        else:
            _fonts[key] = ImageFont.load_default(size * SS)
    return _fonts[key]


def pt(c, angle, length):
    """The point at a distance from c, in a direction measured in degrees anticlockwise from 'right'."""
    r = math.radians(angle)
    return (c[0] + length * math.cos(r), c[1] - length * math.sin(r))


class Pic:
    def __init__(self, h, w=W):
        self.w, self.h = w, h
        self.im = Image.new("RGB", (w * SS, h * SS), "white")
        self.d = ImageDraw.Draw(self.im)

    def _p(self, p):
        return (p[0] * SS, p[1] * SS)

    def line(self, a, b, col=INK, width=2.5, dash=0):
        if dash:
            total = math.dist(a, b)
            n = max(1, int(total // (dash * 2)))
            for i in range(n + 1):
                t0, t1 = i * 2 * dash / total, min(1, (i * 2 * dash + dash) / total)
                if t0 >= 1:
                    break
                self.line((a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0),
                          (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1), col, width)
            return
        self.d.line([self._p(a), self._p(b)], fill=col, width=round(width * SS))

    def dot(self, c, r=4.5, col=INK):
        self.d.ellipse([(c[0] - r) * SS, (c[1] - r) * SS, (c[0] + r) * SS, (c[1] + r) * SS], fill=col)

    def text(self, xy, t, size=17, col=INK, anchor="mm", bold=False):
        self.d.text(self._p(xy), t, font=font(size, bold), fill=col, anchor=anchor)

    def arc(self, c, r, a0, a1, col=ORANGE, width=2.5):
        self.d.arc([(c[0] - r) * SS, (c[1] - r) * SS, (c[0] + r) * SS, (c[1] + r) * SS], start=-a1, end=-a0, fill=col, width=round(width * SS))

    def wedge(self, c, r, a0, a1, fill):
        self.d.pieslice([(c[0] - r) * SS, (c[1] - r) * SS, (c[0] + r) * SS, (c[1] + r) * SS], start=-a1, end=-a0, fill=fill)

    def angle(self, c, a0, a1, label=None, col=ORANGE, r=26, lr=None, size=17, fill=None):
        if fill:
            self.wedge(c, r, a0, a1, fill)
        self.arc(c, r, a0, a1, col)
        if label:
            self.text(pt(c, (a0 + a1) / 2, lr or r + 20), label, size, col, bold=True)

    def right_mark(self, c, a0, size=13, col=ORANGE):
        p1, p3 = pt(c, a0, size), pt(c, a0 + 90, size)
        p2 = (p1[0] + p3[0] - c[0], p1[1] + p3[1] - c[1])
        self.line(p1, p2, col, 2)
        self.line(p2, p3, col, 2)

    def arrowhead(self, tip, angle, size=10, col=INK):
        self.d.polygon([self._p(tip), self._p(pt(tip, angle + 155, size)), self._p(pt(tip, angle - 155, size))], fill=col)

    def arrow(self, a, b, col=INK, width=2.5):
        ang = math.degrees(math.atan2(a[1] - b[1], b[0] - a[0]))
        self.line(a, pt(b, ang + 180, 6), col, width)
        self.arrowhead(b, ang, 11, col)

    def rect(self, x, y, w, h, fill=None, outline=INK, width=2, radius=0):
        self.d.rounded_rectangle([x * SS, y * SS, (x + w) * SS, (y + h) * SS], radius=radius * SS, fill=fill,
                                 outline=outline, width=round(width * SS) if outline else 0)

    def ellipse(self, cx, cy, rx, ry, fill=None, outline=INK, width=2):
        self.d.ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], fill=fill,
                       outline=outline, width=round(width * SS) if outline else 0)

    def poly(self, pts, fill=None, outline=INK, width=2.5):
        if fill:
            self.d.polygon([self._p(p) for p in pts], fill=fill)
        for a, b in zip(pts, pts[1:] + pts[:1]):
            self.line(a, b, outline, width)
        for p in pts:
            self.dot(p, width / 2, outline)

    def box(self, x, y, w, h, lines, fill=PALE, outline=NAVY, size=16, bold_first=True):
        self.rect(x, y, w, h, fill, outline, 2, 8)
        step = size + 4
        top = y + h / 2 - step * (len(lines) - 1) / 2
        for i, t in enumerate(lines):
            self.text((x + w / 2, top + i * step), t, size, INK, bold=(bold_first and i == 0))

    def table(self, x, y, widths, rows, row_h=38, head_h=None, size=16, bold_last=False):
        """rows[0] is the heading row. A cell is text, a list of lines, or a function(pic, x, y, w, h) that draws."""
        head_h = head_h or row_h
        total = sum(widths)
        height = head_h + row_h * (len(rows) - 1)
        self.rect(x, y, total, head_h, NAVY, None)
        if bold_last:
            self.rect(x, y + height - row_h, total, row_h, PALE, None)
        cy = y
        for r, row in enumerate(rows):
            h = head_h if r == 0 else row_h
            cx = x
            for cell, w in zip(row, widths):
                if callable(cell):
                    cell(self, cx, cy, w, h)
                else:
                    lines = cell if isinstance(cell, list) else [cell]
                    step = size + 3
                    top = cy + h / 2 - step * (len(lines) - 1) / 2
                    for i, t in enumerate(lines):
                        self.text((cx + w / 2, top + i * step), str(t), size, "white" if r == 0 else INK,
                                  bold=(r == 0 or (bold_last and r == len(rows) - 1)))
                cx += w
            cy += h
            self.line((x, cy), (x + total, cy), LINE, 1.5)
        cx = x
        for w in widths[:-1]:
            cx += w
            self.line((cx, y + head_h), (cx, y + height), LINE, 1.5)
        self.rect(x, y, total, height, None, NAVY, 2)

    def save(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.im.resize((self.w * OUT, self.h * OUT), Image.LANCZOS).save(path, "WEBP", quality=84, method=6)


def tally(n):
    """A table cell that draws n tally marks in bundles of five."""
    def draw(p, x, y, w, h):
        gap, height, bundle = 8, 20, 50
        groups = (n + 4) // 5
        px = x + (w - (groups * bundle - 12)) / 2 if groups else x
        top = y + (h - height) / 2
        left = n
        while left > 0:
            k = min(left, 5)
            for i in range(min(k, 4)):
                p.line((px + i * gap, top), (px + i * gap, top + height), INK, 2.2)
            if k == 5:
                p.line((px - 5, top + height - 3), (px + 3 * gap + 5, top + 3), ORANGE, 2.2)
            px += bundle
            left -= k
    return draw


# ---------------------------------------------------------------- angles and lines

def angle_types(kinds):
    rows = (len(kinds) + 1) // 2
    p = Pic(rows * 158 + 4)
    for i, (name, deg, note) in enumerate(kinds):
        x0, y0 = (i % 2) * 240, (i // 2) * 158
        if deg == 180:
            v = (x0 + 120, y0 + 92)
        elif deg > 180:
            v = (x0 + 120, y0 + 62)
        else:
            v = (x0 + (105 if deg > 90 else 70), y0 + 100)
        length = 78 if deg <= 180 else 58
        if deg == 90:
            p.right_mark(v, 0)
        else:
            p.angle(v, 0, deg, f"{deg}°", r=22 if deg > 90 else 30, lr=(40 if deg > 180 else None), fill=PALE_O)
        p.line(v, pt(v, 0, length), NAVY, 3)
        p.line(v, pt(v, deg, length), NAVY, 3)
        p.dot(v, 4, NAVY)
        if deg == 90:
            p.text(pt(v, 45, 36), "90°", 17, ORANGE, bold=True)
        p.text((x0 + 120, y0 + 124), name, 17, INK, bold=True)
        p.text((x0 + 120, y0 + 144), note, 15, GREY)
    return p


def p5_angle_types():
    return angle_types([("Acute angle", 50, "less than 90°"), ("Right angle", 90, "exactly 90°"),
                        ("Obtuse angle", 130, "between 90° and 180°"), ("Straight angle", 180, "exactly 180°")])


def s1_angle_types():
    return angle_types([("Acute angle", 50, "less than 90°"), ("Right angle", 90, "exactly 90°"),
                        ("Obtuse angle", 130, "between 90° and 180°"), ("Straight angle", 180, "exactly 180°"),
                        ("Reflex angle", 250, "between 180° and 360°"), ("Full turn", 360, "exactly 360°")])


def bisect():
    p = Pic(212)
    for x0, deg in ((0, 90), (240, 60)):
        v = (x0 + 55, 150)
        half = deg // 2
        p.angle(v, 0, half, f"{half}°", ORANGE, r=44, lr=72, fill=PALE_O)
        p.angle(v, half, deg, f"{half}°", TEAL, r=44, lr=72, fill=PALE_T)
        p.line(v, pt(v, 0, 130), NAVY, 3)
        p.line(v, pt(v, deg, 130), NAVY, 3)
        p.line(v, pt(v, half, 138), GREY, 2.2, dash=6)
        p.dot(v, 4, NAVY)
        p.text((x0 + 120, 190), f"{deg}° ÷ 2 = {half}°", 18, INK, bold=True)
    return p


def straight_line():
    p = Pic(170)
    v = (240, 135)
    p.angle(v, 0, 50, "50°", ORANGE, r=38, fill=PALE_O)
    p.angle(v, 50, 180, "130°", TEAL, r=38, fill=PALE_T)
    p.line((40, 135), (440, 135), NAVY, 3)
    p.line(v, pt(v, 50, 120), NAVY, 3)
    p.dot(v, 4, NAVY)
    p.text((240, 158), "130° + 50° = 180°", 18, INK, bold=True)
    return p


def crossing_lines():
    p = Pic(262)
    c = (240, 118)
    for a0, a1, label, col, fill in ((0, 50, "50°", ORANGE, PALE_O), (50, 180, "130°", TEAL, PALE_T),
                                     (180, 230, "50°", ORANGE, PALE_O), (230, 360, "130°", TEAL, PALE_T)):
        p.angle(c, a0, a1, label, col, r=36, fill=fill)
    p.line((50, 118), (430, 118), NAVY, 3)
    p.line(pt(c, 50, 130), pt(c, 230, 130), NAVY, 3)
    p.dot(c, 4, NAVY)
    p.text((240, 240), "Opposite angles are equal", 18, INK, bold=True)
    return p


def parallel_angles():
    p = Pic(3 * 150)
    rows = [("Corresponding", "angles are equal", "Look for the letter F", [(1, 0, 60, ORANGE, PALE_O), (2, 0, 60, ORANGE, PALE_O)]),
            ("Alternate", "angles are equal", "Look for the letter Z", [(1, 180, 240, ORANGE, PALE_O), (2, 0, 60, ORANGE, PALE_O)]),
            ("Co-interior", "angles add up to 180°", "Look for the letter C", [(1, 240, 360, TEAL, PALE_T), (2, 0, 60, ORANGE, PALE_O)])]
    for i, (name, rule, hint, marks) in enumerate(rows):
        y0 = i * 150
        if i:
            p.line((20, y0), (460, y0), LINE, 1.5)
        p1 = (175, y0 + 45)
        p2 = (175 - 65 / math.tan(math.radians(60)), y0 + 110)
        for which, a0, a1, col, fill in marks:
            p.angle(p1 if which == 1 else p2, a0, a1, None, col, r=24, fill=fill)
        for y in (y0 + 45, y0 + 110):
            p.line((30, y), (270, y), NAVY, 3)
            p.arrowhead((276, y), 0, 9, NAVY)
        p.line(pt(p1, 60, 36), pt(p2, 240, 36), NAVY, 3)
        p.text((300, y0 + 50), name, 18, INK, "lm", bold=True)
        p.text((300, y0 + 74), rule, 16, INK, "lm")
        p.text((300, y0 + 98), hint, 15, GREY, "lm")
    return p


def triangle():
    p = Pic(250)
    a, b = (150, 200), (330, 200)
    t = 180 * math.sin(math.radians(70)) / math.sin(math.radians(50))
    c = pt(a, 60, t)
    p.angle(a, 0, 60, "60°", ORANGE, r=30, fill=PALE_O)
    p.angle(b, 110, 180, "70°", TEAL, r=30, fill=PALE_T)
    p.angle(c, 240, 290, "?", NAVY, r=30, lr=50, size=20, fill=PALE)
    p.poly([a, b, c], None, NAVY, 3)
    p.text((240, 230), "60° + 70° + ? = 180°", 18, INK, bold=True)
    return p


def lines_picture():
    p = Pic(210)
    for i, (name, note) in enumerate((("Line", "no endpoints"), ("Line segment", "two endpoints"), ("Ray", "one endpoint"))):
        y = 38 + i * 68
        a, b = (40, y), (240, y)
        p.line(a, b, NAVY, 3)
        if i == 0:
            p.arrowhead((30, y), 180, 12, NAVY)
            p.arrowhead((250, y), 0, 12, NAVY)
        elif i == 1:
            p.dot(a, 6, ORANGE)
            p.dot(b, 6, ORANGE)
        else:
            p.dot(a, 6, ORANGE)
            p.arrowhead((250, y), 0, 12, NAVY)
        p.text((280, y - 11), name, 18, INK, "lm", bold=True)
        p.text((280, y + 12), note, 16, GREY, "lm")
    return p


def at_a_point():
    p = Pic(262)
    c = (240, 118)
    for a0, a1, label, col, fill in ((0, 120, "120°", ORANGE, PALE_O), (120, 215, "95°", TEAL, PALE_T), (215, 360, "a", NAVY, PALE)):
        p.angle(c, a0, a1, label, col, r=36, lr=60, size=18, fill=fill)
    for ang in (0, 120, 215):
        p.line(c, pt(c, ang, 125), NAVY, 3)
    p.dot(c, 4, NAVY)
    p.text((240, 240), "120° + 95° + a = 360°", 18, INK, bold=True)
    return p


def polygon_triangles():
    p = Pic(215)
    for i, n in enumerate((4, 5, 6)):
        cx, cy, r = 80 + i * 160, 78, 60
        pts = [pt((cx, cy), 90 + 360 / n * k + (45 if n == 4 else 0), r) for k in range(n)]
        p.poly(pts, PALE, NAVY, 3)
        for k in range(2, n - 1):
            p.line(pts[0], pts[k], ORANGE, 2.2, dash=5)
        p.text((cx, 158), f"{n} sides", 17, INK, bold=True)
        p.text((cx, 178), f"{n - 2} triangles", 15, INK)
        p.text((cx, 198), f"{n - 2} × 180° = {(n - 2) * 180}°", 15, GREY)
    return p


# ---------------------------------------------------------------- data and statistics

def data_kinds():
    p = Pic(300)
    p.line((240, 52), (120, 96), GREY, 2)
    p.line((240, 52), (360, 96), GREY, 2)
    p.line((360, 162), (250, 206), GREY, 2)
    p.line((360, 162), (400, 206), GREY, 2)
    p.box(180, 12, 120, 40, ["Data"], NAVY, NAVY)
    p.text((240, 32), "Data", 17, "white", bold=True)
    p.box(15, 96, 210, 66, ["Qualitative", "words", "red, salty, a dog"], PALE_O, ORANGE, 15)
    p.box(255, 96, 210, 66, ["Quantitative", "numbers", "how many? how much?"], PALE_T, TEAL, 15)
    p.box(170, 206, 145, 82, ["Discrete", "you count it", "4 goals"], PALE, NAVY, 15)
    p.box(325, 206, 145, 82, ["Continuous", "you measure it", "1.40 m"], PALE, NAVY, 15)
    return p


FRUIT = [("Banana", 8), ("Mango", 6), ("Avocado", 4), ("Orange", 2)]


def tally_chart():
    p = Pic(220)
    rows = [["Fruit", "Tally", "Frequency"]] + [[name, tally(n), n] for name, n in FRUIT]
    p.table(20, 12, [140, 180, 120], rows, row_h=39)
    return p


def axes(p, left, top, right, bottom, ymax, step, unit=""):
    for v in range(0, ymax + 1, step):
        y = bottom - (bottom - top) * v / ymax
        p.line((left, y), (right, y), LINE, 1.2)
        p.text((left - 8, y), f"{v}", 15, GREY, "rm")
    p.line((left, top - 8), (left, bottom), INK, 2.5)
    p.line((left, bottom), (right, bottom), INK, 2.5)
    return lambda v: bottom - (bottom - top) * v / ymax


def bar_chart():
    p = Pic(300)
    p.text((240, 20), "Favourite fruit of 20 pupils", 18, INK, bold=True)
    p.text((14, 44), "Number of pupils", 14, GREY, "lm")
    yof = axes(p, 50, 62, 460, 250, 10, 2)
    for i, (name, n) in enumerate(FRUIT):
        x = 80 + i * 96
        p.rect(x, yof(n), 62, 250 - yof(n), TEAL if i == 0 else "#7fc4b1", None)
        p.text((x + 31, yof(n) - 12), str(n), 16, INK, bold=True)
        p.text((x + 31, 268), name, 15, INK)
    p.line((50, 250), (460, 250), INK, 2.5)
    return p


def line_graph():
    p = Pic(300)
    p.text((240, 20), "Height of a maize plant", 18, INK, bold=True)
    p.text((14, 44), "Height (cm)", 14, GREY, "lm")
    yof = axes(p, 50, 62, 460, 250, 30, 5)
    data = [10, 15, 25, 30]
    pts = [(125 + i * 98, yof(v)) for i, v in enumerate(data)]
    for a, b in zip(pts, pts[1:]):
        p.line(a, b, ORANGE, 3)
    for i, (pnt, v) in enumerate(zip(pts, data)):
        p.dot(pnt, 6, ORANGE)
        p.text((pnt[0] - 4, pnt[1] - 17), f"{v} cm", 15, INK, "rm", bold=True)
        p.text((pnt[0], 268), f"Week {i + 1}", 15, INK)
    return p


MARKS = [(1, 2), (2, 3), (3, 6), (4, 5), (5, 4)]


def frequency_table():
    p = Pic(262)
    rows, running = [["Mark", "Tally", "Frequency", ["Cumulative", "frequency"]]], 0
    for mark, f in MARKS:
        running += f
        rows.append([mark, tally(f), f, running])
    p.table(15, 10, [70, 150, 110, 120], rows, row_h=38, head_h=50)
    return p


def mean_table():
    p = Pic(300)
    rows = [["Mark", "Frequency", "Mark × frequency"]] + [[m, f, m * f] for m, f in MARKS]
    rows.append(["Total", sum(f for _, f in MARKS), sum(m * f for m, f in MARKS)])
    p.table(20, 10, [110, 140, 190], rows, row_h=36, bold_last=True)
    p.text((240, 280), "Mean = 66 ÷ 20 = 3.3", 18, INK, bold=True)
    return p


def median_picture():
    p = Pic(232)
    for y, title, values, middle, answer in ((14, "5 values: one middle value", [3, 3, 5, 7, 9], {2}, "Median = 5"),
                                             (128, "4 values: two middle values", [4, 6, 8, 10], {1, 2}, "Median = (6 + 8) ÷ 2 = 7")):
        p.text((20, y + 8), title, 16, GREY, "lm")
        x = 20
        for i, v in enumerate(values):
            hot = i in middle
            p.rect(x, y + 24, 46, 40, PALE_O if hot else PALE, ORANGE if hot else NAVY, 2.5 if hot else 1.5, 6)
            p.text((x + 23, y + 44), str(v), 18, INK, bold=hot)
            x += 54
        p.text((20, y + 84), answer, 18, INK, "lm", bold=True)
    return p


# ---------------------------------------------------------------- English

def timeline(future):
    p = Pic(176)
    col, pale = (TEAL, PALE_T) if future else (ORANGE, PALE_O)
    p.line((30, 78), (444, 78), LINE, 4)
    p.arrowhead((454, 78), 0, 13, GREY)
    p.line((240, 78), (444, 78), col, 5) if future else p.line((30, 78), (240, 78), col, 5)
    p.line((240, 58), (240, 98), INK, 3)
    p.text((240, 40), "NOW", 17, INK, bold=True)
    for x, label in (((330, "tomorrow"), (415, "next year")) if future else ((70, "last week"), (160, "yesterday"))):
        p.dot((x, 78), 6, col)
        p.text((x, 104), label, 15, INK)
    p.text((345 if future else 125, 22), "FUTURE" if future else "PAST", 16, col, bold=True)
    p.rect(40, 126, 400, 38, pale, None, 0, 8)
    p.text((240, 145), "I am going to play tomorrow." if future else "I played football yesterday.", 17, INK, bold=True)
    return p


def person(p, x, base, height, col):
    head = height * 0.115
    p.rect(x - height * 0.15, base - height + head * 2 + 3, height * 0.30, height - head * 2 - 3, col, None, 0, 10)
    p.ellipse(x, base - height + head, head, head, col, None)


def people(rows, caption):
    p = Pic(318)
    base = 232
    n = len(rows)
    for i, (name, metres, note, col) in enumerate(rows):
        x = 240 + (i - (n - 1) / 2) * (150 if n == 2 else 140)
        h = (metres - 1.20) * 400 + 60
        person(p, x, base, h, col)
        p.line((x - 44, base - h), (x + 44, base - h), GREY, 1.5, dash=4)
        p.text((x, base - h - 14), f"{metres:.2f} m", 15, GREY)
        p.text((x, base + 16), name, 17, INK, bold=True)
        if note:
            p.text((x, base + 36), note, 15, col, bold=True)
    p.line((40, base), (440, base), INK, 2.5)
    p.text((240, 300), caption, 17, INK, bold=True)
    return p


def taller():
    return people([("Keza", 1.50, "", TEAL), ("Aline", 1.42, "", ORANGE)], "Keza is taller than Aline.")


def tallest():
    return people([("Keza", 1.50, "the tallest", TEAL), ("Aline", 1.42, "", GREY), ("Jane", 1.38, "the shortest", ORANGE)],
                  "Keza is the tallest of the three.")


# ---------------------------------------------------------------- Biology

def key_picture():
    p = Pic(262)
    def link(a, b, label):
        p.line(a, b, GREY, 2)
        p.text(((a[0] + b[0]) / 2 + (-6 if b[0] < a[0] else 6), (a[1] + b[1]) / 2 - 2), label, 15, ORANGE,
               "rm" if b[0] < a[0] else "lm", bold=True)
    link((240, 52), (125, 104), "Yes")
    link((240, 52), (355, 104), "No")
    link((125, 146), (65, 204), "Feathers")
    link((125, 146), (180, 204), "Fur")
    link((355, 146), (300, 204), "Yes")
    link((355, 146), (415, 204), "No")
    p.box(150, 12, 180, 40, ["Does it have legs?"], PALE, NAVY, 16)
    p.box(30, 104, 190, 42, ["Feathers or fur?"], PALE, NAVY, 16)
    p.box(260, 104, 190, 42, ["Does it have fins?"], PALE, NAVY, 16)
    for x, name in ((15, "Hen"), (130, "Goat"), (250, "Tilapia"), (365, "Earthworm")):
        p.box(x, 204, 100, 42, [name], PALE_T, TEAL, 16)
    return p


def levels():
    p = Pic(318)
    names = ["Kingdom", "Phylum", "Class", "Order", "Family", "Genus", "Species"]
    p.text((240, 16), "Largest group: many different organisms", 15, GREY)
    for i, name in enumerate(names):
        w = 420 - i * 44
        p.rect(240 - w / 2, 32 + i * 37, w, 32, [NAVY, "#2c5282", "#2b6c8f", "#23808a", TEAL, "#3f9d7c", "#62b08a"][i], None, 0, 7)
        p.text((240, 48 + i * 37), name, 17, "white", bold=True)
    p.text((240, 302), "Smallest group: very closely related organisms", 15, GREY)
    return p


def five_kingdoms():
    p = Pic(336)
    rows = [("Animalia", NAVY, "Many cells, no cell wall.", "Feed on other organisms.", "Example: bird"),
            ("Plantae", TEAL, "Cell wall and chlorophyll.", "Make their own food.", "Example: maize"),
            ("Fungi", ORANGE, "No photosynthesis.", "Reproduce by spores.", "Example: mushroom"),
            ("Protoctista", "#7a5aa6", "Single cells", "with a true nucleus.", "Example: amoeba"),
            ("Monera", "#b0483f", "Single cells", "with no true nucleus.", "Example: bacteria")]
    for i, (name, col, l1, l2, l3) in enumerate(rows):
        y = 8 + i * 65
        p.rect(12, y, 456, 58, PALE, None, 0, 8)
        p.rect(12, y, 136, 58, col, None, 0, 8)
        p.text((80, y + 29), name, 17, "white", bold=True)
        p.text((160, y + 12), l1, 15, INK, "lm")
        p.text((160, y + 30), l2, 15, INK, "lm")
        p.text((160, y + 47), l3, 14, GREY, "lm")
    return p


def cell_to_organism():
    p = Pic(120)
    items = [("Cell", "muscle cell"), ("Tissue", "muscle"), ("Organ", "heart"), ("Organism", "goat")]
    for i, (name, example) in enumerate(items):
        x = 10 + i * 119
        p.box(x, 22, 100, 44, [name], [PALE, PALE_T, PALE_O, PALE][i], NAVY, 16)
        p.text((x + 50, 86), example, 15, GREY)
        if i < 3:
            p.arrow((x + 102, 44), (x + 117, 44), ORANGE, 2.5)
    return p


def labels(p, x, items):
    for y, text, target in items:
        p.line((x - 6, y), target, GREY, 1.6)
        p.dot(target, 3, GREY)
        p.text((x, y), text, 16, INK, "lm")


def mito(p, x, y, upright=False):
    p.ellipse(x, y, 8 if upright else 16, 16 if upright else 8, "#f3b27a", "#b85c14", 1.6)


def animal_cell():
    p = Pic(290)
    p.text((165, 18), "Animal cell", 18, INK, bold=True)
    p.ellipse(165, 160, 135, 108, "#fdf1e3", NAVY, 3.5)
    p.ellipse(165, 160, 36, 34, "#b9c7e6", NAVY, 2.2)
    p.ellipse(172, 154, 9, 9, NAVY, None)
    for x, y in ((90, 120), (245, 208), (105, 215)):
        mito(p, x, y)
    for x, y in ((228, 108), (212, 128)):
        p.ellipse(x, y, 10, 10, "#d6ecf8", "#3d7fb0", 1.6)
    labels(p, 335, [(70, "Small vacuole", (232, 104)), (112, "Cell membrane", pt((165, 160), 22, 132)),
                    (154, "Nucleus", (198, 158)), (196, "Cytoplasm", (262, 172)), (238, "Mitochondrion", (256, 211))])
    return p


def plant_cell():
    p = Pic(300)
    p.text((165, 18), "Plant cell", 18, INK, bold=True)
    p.rect(30, 36, 270, 248, "#9ccc8f", "#2f6b2a", 3, 10)
    p.rect(40, 46, 250, 228, "#eef8e6", NAVY, 2.2, 6)
    p.rect(84, 88, 160, 146, "#d6ecf8", "#3d7fb0", 2, 14)
    p.ellipse(267, 156, 15, 15, "#b9c7e6", NAVY, 2)
    p.ellipse(270, 153, 4.5, 4.5, NAVY, None)
    for x, y in ((110, 67), (165, 65), (222, 67), (125, 254), (190, 256)):
        p.ellipse(x, y, 14, 7.5, "#4fa843", "#2f6b2a", 1.6)
    for x, y in ((62, 110), (62, 165), (62, 220)):
        p.ellipse(x, y, 7.5, 14, "#4fa843", "#2f6b2a", 1.6)
    mito(p, 248, 256)
    mito(p, 267, 105, upright=True)
    labels(p, 335, [(48, "Cell wall", (299, 52)), (84, "Cell membrane", (289, 84)), (120, "Chloroplast", (232, 68)),
                    (156, "Nucleus", (281, 156)), (192, "Large vacuole", (232, 188)), (228, "Cytoplasm", (270, 212)),
                    (264, "Mitochondrion", (260, 258))])
    return p


# ---------------------------------------------------------------- which picture goes where

PICTURES = [
    # (lesson folder, file name, function, what the picture shows)
    ("primary/math-p5-en/week1/m1", "angle-types.webp", p5_angle_types, "Four angles: an acute angle of 50 degrees, a right angle of 90 degrees, an obtuse angle of 130 degrees and a straight angle of 180 degrees"),
    ("primary/math-p5-en/week1/m1", "bisect.webp", bisect, "A dotted line cuts a 90 degree angle into two angles of 45 degrees, and a 60 degree angle into two angles of 30 degrees"),
    ("primary/math-p5-en/week1/m2", "straight-line.webp", straight_line, "Two angles on a straight line, 130 degrees and 50 degrees, add up to 180 degrees"),
    ("primary/math-p5-en/week1/m2", "crossing-lines.webp", crossing_lines, "Two lines cross and make four angles: 50 degrees, 130 degrees, 50 degrees and 130 degrees. The angles that face each other are equal"),
    ("primary/math-p5-en/week1/m3", "parallel-angles.webp", parallel_angles, "A line crosses two parallel lines. Three drawings mark the corresponding angles, the alternate angles and the co-interior angles"),
    ("primary/math-p5-en/week1/m3", "triangle.webp", triangle, "A triangle with angles of 60 degrees and 70 degrees and one unknown angle"),
    ("primary/math-p5-en/week2/m1", "kinds-of-data.webp", data_kinds, "A chart: data is qualitative or quantitative, and quantitative data is discrete or continuous"),
    ("primary/math-p5-en/week2/m2", "tally-chart.webp", tally_chart, "A tally chart of favourite fruit: banana 8, mango 6, avocado 4, orange 2"),
    ("primary/math-p5-en/week2/m2", "bar-chart.webp", bar_chart, "A bar chart of favourite fruit. The bars show banana 8, mango 6, avocado 4 and orange 2"),
    ("primary/math-p5-en/week2/m3", "line-graph.webp", line_graph, "A line graph of the height of a maize plant: 10 cm in week 1, 15 cm in week 2, 25 cm in week 3 and 30 cm in week 4"),
    ("primary/english-p5-en/week1/m1", "past.webp", lambda: timeline(False), "A time line. Last week and yesterday are before now, in the past. Example: I played football yesterday"),
    ("primary/english-p5-en/week1/m3", "future.webp", lambda: timeline(True), "A time line. Tomorrow and next year are after now, in the future. Example: I am going to play tomorrow"),
    ("primary/english-p5-en/week2/m1", "taller.webp", taller, "Two girls stand side by side. Keza is 1.50 metres tall and Aline is 1.42 metres tall. Keza is taller than Aline"),
    ("primary/english-p5-en/week2/m3", "tallest.webp", tallest, "Three girls stand side by side. Keza, 1.50 metres, is the tallest. Jane, 1.38 metres, is the shortest"),
    ("secondary/math-s1-en/week1/m1", "lines.webp", lines_picture, "A line with an arrow at each end, a line segment with two endpoints, and a ray with one endpoint and one arrow"),
    ("secondary/math-s1-en/week1/m1", "angle-types.webp", s1_angle_types, "Six angles: acute 50 degrees, right 90 degrees, obtuse 130 degrees, straight 180 degrees, reflex 250 degrees and a full turn of 360 degrees"),
    ("secondary/math-s1-en/week1/m2", "parallel-angles.webp", parallel_angles, "A transversal crosses two parallel lines. Three drawings mark the corresponding angles, the alternate angles and the co-interior angles"),
    ("secondary/math-s1-en/week1/m2", "angles-at-a-point.webp", at_a_point, "Three angles meet at a point: 120 degrees, 95 degrees and an unknown angle a"),
    ("secondary/math-s1-en/week1/m3", "polygon-triangles.webp", polygon_triangles, "A quadrilateral cut into 2 triangles, a pentagon cut into 3 triangles and a hexagon cut into 4 triangles"),
    ("secondary/math-s1-en/week2/m1", "frequency-table.webp", frequency_table, "A frequency table for marks 1 to 5 with tally marks, frequencies 2, 3, 6, 5, 4 and cumulative frequencies 2, 5, 11, 16, 20"),
    ("secondary/math-s1-en/week2/m2", "mean-table.webp", mean_table, "A table that multiplies each mark by its frequency. The total frequency is 20 and the total of mark times frequency is 66, so the mean is 3.3"),
    ("secondary/math-s1-en/week2/m3", "median.webp", median_picture, "The ordered values 3, 3, 5, 7, 9 with the middle value 5 marked, and the ordered values 4, 6, 8, 10 with the two middle values 6 and 8 marked"),
    ("secondary/biology-s1-en/week1/m1", "key.webp", key_picture, "A key drawn as a tree. Legs and feathers lead to hen, legs and fur to goat, no legs and fins to tilapia, no legs and no fins to earthworm"),
    ("secondary/biology-s1-en/week1/m2", "levels.webp", levels, "Seven levels from the largest group to the smallest: kingdom, phylum, class, order, family, genus, species"),
    ("secondary/biology-s1-en/week1/m3", "five-kingdoms.webp", five_kingdoms, "A chart of the five kingdoms, Animalia, Plantae, Fungi, Protoctista and Monera, with their main features and one example each"),
    ("secondary/biology-s1-en/week2/m1", "cell-to-organism.webp", cell_to_organism, "Four boxes joined by arrows: cell, tissue, organ, organism"),
    ("secondary/biology-s1-en/week2/m2", "animal-cell.webp", animal_cell, "A labelled animal cell: cell membrane, cytoplasm, nucleus, mitochondrion and small vacuole"),
    ("secondary/biology-s1-en/week2/m3", "plant-cell.webp", plant_cell, "A labelled plant cell: cell wall, cell membrane, chloroplast, nucleus, large vacuole, cytoplasm and mitochondrion"),
    ("secondary/biology-s1-en/week2/m3", "animal-cell.webp", animal_cell, "A labelled animal cell: cell membrane, cytoplasm, nucleus, mitochondrion and small vacuole"),
]


def main():
    if "--list" in sys.argv:
        for folder, name, _, alt in PICTURES:
            print(f"{folder}/{name}\n    {alt}")
        return
    for folder, name, draw, _ in PICTURES:
        out = CONTENT / folder / name
        draw().save(out)
        print(f"drew {out.relative_to(ROOT).as_posix()}  ({max(1, round(out.stat().st_size / 1024))} KB)")
    print(f"{len(PICTURES)} pictures. Next: python3 tools/build_packs.py")


if __name__ == "__main__":
    main()
