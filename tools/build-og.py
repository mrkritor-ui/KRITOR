#!/usr/bin/env python3
"""KRITOR — social share cards.

A link pasted into a message, a feed or a search result is shown as a picture
before it is shown as anything else. Until now every page offered the same one
of two things: a 1080x1218 portrait of ArtShed, which no platform's 1.91:1 frame
can show whole, or the site icon. This builds, from the paintings themselves,
the card each page should be shown with:

    og/<work id>.jpg        one per catalogue work       (/work-05/)
    og/<product id>.jpg     one per shop item            (/shop/artshed-original/)
    og/default.jpg          the site itself — the front door, the rooms, About

1200x630, the size every platform asks for. The painting is trimmed to its own
edges (see trim.py: several of the source photos are square crops with white
wall or transparent margin around the work), set whole — never cropped — in a
2px black frame on the site's paper grey, beside its title in the site face.
The work is the picture; the left-hand column only says whose and which.

Output goes to og/ and is not committed: the Pages workflow runs this at deploy
time, after tools/build-routes.js (it reads products.json), so a card can never
drift from the painting, title or size it describes. build-routes.js writes the
URLs of these files into each page, and tools/check-site.js fails the deploy if
one is missing or the wrong size.

    python3 tools/build-routes.js && python3 tools/build-og.py

The face is pix-chicago.ttf next to this file — the same outlines as the site's
woff2 (see fonts/README.md), because Pillow cannot read WOFF2. It is drawn at
multiples of 8px, where every stroke of the bitmap lands on a whole pixel.
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from trim import content_bbox

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "og"
FONT = Path(__file__).resolve().parent / "pix-chicago.ttf"

WIDTH, HEIGHT = 1200, 630
PAPER = (227, 227, 227)     # the light theme's paper, so the card is the site
INK = (0, 0, 0)
PAD = 48
FRAME = 4                    # the site's 2px box, at the card's scale
TEXT_COLUMN = 330            # left: who and which
GAP = 40
ART = (PAD + TEXT_COLUMN + GAP, PAD, WIDTH - PAD, HEIGHT - PAD)   # right: the work

# What the front door and the rooms are shown with: two of the catalogue's
# strongest portraits side by side. Falls back to the first works with an image
# if either is ever removed.
DEFAULT_WORKS = ["work-05", "work-01"]


def font(size):
    return ImageFont.truetype(str(FONT), size, layout_engine=ImageFont.Layout.BASIC)


def wrap(draw, text, face, width):
    """Greedy word wrap; None if a single word is wider than the column."""
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=face) <= width:
            line = trial
        elif not line:
            return None
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def title_block(draw, title, width, max_lines=4):
    """The biggest size, from 32px down, at which the title fits the column."""
    for size in (32, 24, 16):
        face = font(size)
        lines = wrap(draw, title, face, width)
        if lines and len(lines) <= max_lines:
            return face, lines, size
    face = font(16)
    return face, [title[:22] + "..."], 16


def read_works():
    text = (ROOT / "artworks.js").read_text()
    return json.loads(text[text.index("["):text.rindex("]") + 1])


def read_products():
    path = ROOT / "products.json"
    if not path.exists():
        sys.exit("products.json is missing — run tools/build-routes.js first")
    return json.loads(path.read_text())


def open_painting(rel):
    """The painting trimmed to its own edges, and whether it is, near enough, a
    rectangle. A few exports have a transparent corner trimmed off, which a
    frame still suits; a work that is really another shape (round, cut out)
    would sit in a rectangle of paper, so it is set without one."""
    with Image.open(ROOT / rel.lstrip("/")) as im:
        im = im.convert("RGBA")
    alpha = im.getchannel("A")
    box = content_bbox(im, alpha)
    im = im.crop(box)
    cut = alpha.crop(box).point(lambda v: 255 if v > 128 else 0)
    solid = cut.histogram()[255] >= 0.9 * cut.width * cut.height
    return im, solid


def place(card, rel, area):
    """Draw one painting, whole, centred in `area` (left, top, right, bottom)."""
    im, solid = open_painting(rel)
    left, top, right, bottom = area
    inset = FRAME if solid else 0
    scale = min((right - left - 2 * inset) / im.width, (bottom - top - 2 * inset) / im.height)
    w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    im = im.resize((w, h), Image.Resampling.LANCZOS)
    x = left + (right - left - w) // 2
    y = top + (bottom - top - h) // 2
    if solid:
        ImageDraw.Draw(card).rectangle([x - FRAME, y - FRAME, x + w + FRAME - 1, y + h + FRAME - 1], fill=INK)
    card.paste(im, (x, y), im)
    return (x, y, w, h)


def blank():
    return Image.new("RGB", (WIDTH, HEIGHT), PAPER)


def left_column(card, label, title, meta):
    """KRITOR and what this is at the top; title and facts at the foot."""
    draw = ImageDraw.Draw(card)
    draw.fontmode = "1"                       # no anti-aliasing: it is a bitmap face
    draw.text((PAD, PAD), "KRITOR", font=font(48), fill=INK)
    draw.text((PAD, PAD + 72), label, font=font(16), fill=INK)

    bottom = HEIGHT - PAD
    if meta:
        face = font(16)
        draw.text((PAD, bottom - 16 * 1.5), meta, font=face, fill=INK)
        bottom -= 16 * 1.5 + 20
    if title:
        face, lines, size = title_block(draw, title, TEXT_COLUMN)
        leading = round(size * 1.5)
        top = bottom - leading * len(lines)
        for i, line in enumerate(lines):
            draw.text((PAD, top + i * leading), line, font=face, fill=INK)


def facts(*parts):
    return " · ".join(str(p).upper() for p in parts if p)


def measured(size):
    """A size is a fact only if it has a number in it — "— × — cm" is not."""
    return size if any(c.isdigit() for c in size or "") else ""


def save(card, name):
    OUT_DIR.mkdir(exist_ok=True)
    card.save(OUT_DIR / f"{name}.jpg", "JPEG", quality=90, subsampling=0, optimize=True, progressive=True)


def work_card(work):
    card = blank()
    place(card, work["image"], ART)
    left_column(card, "ART CATALOGUE", (work.get("title") or "Untitled").upper(),
                facts(work.get("year"), measured(work.get("size"))))
    save(card, work["id"])


def product_card(item):
    card = blank()
    place(card, item["images"][0], ART)
    left_column(card, "STORE", (item.get("title") or "Original work").upper(),
                facts(item.get("year"), measured(item.get("size")), item.get("edition")))
    save(card, item["id"])


def default_card(works):
    """The site: two paintings at one height, side by side."""
    by_id = {w["id"]: w for w in works if w.get("image")}
    chosen = [by_id[i] for i in DEFAULT_WORKS if i in by_id]
    chosen += [w for w in by_id.values() if w not in chosen][: 2 - len(chosen)]

    card = blank()
    left, top, right, bottom = ART
    opened = [open_painting(w["image"]) for w in chosen]
    gutter = 24
    avail_w = right - left - gutter * (len(opened) - 1) - 2 * FRAME * len(opened)
    avail_h = bottom - top - 2 * FRAME
    aspects = [im.width / im.height for im, _ in opened]
    height = min(avail_h, avail_w / sum(aspects))
    widths = [round(height * a) for a in aspects]
    total = sum(widths) + gutter * (len(opened) - 1) + 2 * FRAME * len(opened)
    x = left + (right - left - total) // 2
    y = top + (bottom - top - round(height)) // 2
    draw = ImageDraw.Draw(card)
    for (im, solid), w in zip(opened, widths):
        im = im.resize((w, round(height)), Image.Resampling.LANCZOS)
        if solid:
            draw.rectangle([x, y - FRAME, x + w + 2 * FRAME - 1, y + round(height) + FRAME - 1], fill=INK)
        card.paste(im, (x + FRAME, y), im)
        x += w + 2 * FRAME + gutter
    left_column(card, "CONTEMPORARY ARTIST", "", "MELBOURNE")
    save(card, "default")


def main():
    works, products = read_works(), read_products()
    built = 0
    for work in works:
        if work.get("image"):
            work_card(work)
            built += 1
    for item in products:
        if item.get("images"):
            product_card(item)
            built += 1
    default_card(works)
    built += 1

    # Anything in og/ the build did not just write is a card for a page that is
    # gone; do not publish it.
    wanted = {f"{w['id']}.jpg" for w in works if w.get("image")} | {f"{p['id']}.jpg" for p in products if p.get("images")} | {"default.jpg"}
    for stale in OUT_DIR.glob("*.jpg"):
        if stale.name not in wanted:
            stale.unlink()
    size = sum(f.stat().st_size for f in OUT_DIR.glob("*.jpg"))
    print(f"{built} share cards  {size / 1024:.0f} KB  ({WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    main()
