#!/usr/bin/env python3
"""KRITOR — 1-bit "terminal" renditions of the catalogue.

The redesign puts every work on the grid as a black-and-white dithered image,
the way simmondsltd.com does. Getting there is not simply "greyscale it and
threshold", because the source material is the opposite of theirs:

  * Simmonds' images are fashion photographs — a figure against a wall, a logo,
    an interior. Large flat tonal regions, so a hard threshold produces a clean
    readable silhouette.

  * KRITOR's are all-over expressionist paintings. Every square inch is
    high-frequency mark-making, and — the killer — the colours are wildly
    different but land on nearly the SAME luminance. A red, a green and a blue
    of equal brightness all collapse to one grey.

Convert those on luminance and every work becomes the same field of noise: the
catalogue stops distinguishing one painting from the next, which is the one
thing a catalogue has to do. Two conversions were tested against that bar.

    saturation  (default)  Chroma, not brightness. Separates marks that
                           luminance flattens together. It also crops the work
                           optically for free: these are photographs OF
                           paintings, and the desaturated studio wall around
                           the canvas falls to white while the saturated
                           painting keeps its detail.

    highpass               Divide by a heavy blur to strip broad tonal drift
                           and keep the marks. Renders the canvas edge and the
                           drawing underneath more literally, but turns the
                           studio surround into texture, so tiles read heavier
                           and more alike.

Both preserve alpha. Only work 20/21/22 actually carry any (a trimmed corner,
1.6-4.6% of their pixels); the rest are fully opaque rectangles.

Output is a paletted PNG at the pixel grid — a few KB per work against 1-2 MB
originals — meant to be upscaled in CSS with `image-rendering: pixelated`.

    python3 tools/terminal-images.py [--method saturation|highpass]
                                     [--grid 112] [--out derived-1bit]
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent


def slug(rel):
    """A filename-safe stem for a store image, which has no work id of its own."""
    return re.sub(r"[^a-z0-9]+", "-", rel.lower().rsplit(".", 1)[0]).strip("-")


def sources():
    """Every image the terminal renders: the catalogue, then the store.

    The store's inventory is independent of the archive by design, so both
    lists are read — an item for sale need not be a catalogue work."""
    wanted = []

    text = (ROOT / "artworks.js").read_text()
    for work in json.loads(text[text.index("["):text.rindex("]") + 1]):
        if work.get("image"):
            wanted.append((work["id"], work["image"]))

    products = ROOT / "products.js"
    if products.exists():
        text = products.read_text()
        for match in re.finditer(r"images:\s*\[(.*?)\]", text, re.S):
            for rel in re.findall(r'"([^"]+)"', match.group(1)):
                wanted.append((slug(rel), rel))

    seen, out = set(), []
    for work_id, rel in wanted:
        if rel in seen:
            continue
        seen.add(rel)
        out.append((work_id, rel))
    return out


def load(path, grid):
    """Greyscale-ready RGBA plus a hard alpha mask, both at the pixel grid."""
    with Image.open(ROOT / path) as im:
        im = im.convert("RGBA")
    alpha = im.getchannel("A")
    height = max(1, round(im.height * grid / im.width))
    return (
        im.resize((grid, height), Image.Resampling.LANCZOS),
        alpha.resize((grid, height), Image.Resampling.LANCZOS)
             .point(lambda v: 255 if v > 128 else 0),
    )


def saturation(im):
    # Inverted so saturated paint reads as ink and the bare wall reads as page.
    hsv = np.asarray(im.convert("RGB").convert("HSV"), dtype=np.uint8)
    return ImageOps.autocontrast(Image.fromarray(255 - hsv[:, :, 1]), cutoff=2)


def highpass(im):
    grey = im.convert("L")
    sharp = np.asarray(grey, dtype=np.float32) + 1.0
    # Radius scales with the grid so the effect is identical at any grid size.
    blurred = np.asarray(
        grey.filter(ImageFilter.GaussianBlur(max(2.0, im.width / 10))), dtype=np.float32
    ) + 1.0
    ratio = np.clip((sharp / blurred) * 128.0, 0, 255).astype(np.uint8)
    return ImageOps.autocontrast(Image.fromarray(ratio), cutoff=2)


METHODS = {"saturation": saturation, "highpass": highpass}


def dither(grey, alpha):
    """Floyd-Steinberg to 1 bit, as black ink on a transparent ground."""
    bits = grey.convert("1")
    ink = bits.convert("L").point(lambda v: 255 if v < 128 else 0)
    ink = Image.composite(ink, Image.new("L", ink.size, 0), alpha)
    out = Image.new("RGBA", bits.size, (255, 255, 255, 0))
    out.paste((0, 0, 0, 255), (0, 0), ink)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--method", choices=sorted(METHODS), default="saturation")
    parser.add_argument("--grid", type=int, default=112,
                        help="pixel-grid width before CSS upscales it (default 112)")
    parser.add_argument("--out", default="derived-1bit")
    args = parser.parse_args()

    out_dir = ROOT / args.out
    out_dir.mkdir(exist_ok=True)
    convert = METHODS[args.method]

    manifest, original_total, derived_total = {}, 0, 0
    for work_id, rel in sources():
        path = ROOT / rel
        if not path.exists():
            print(f"  ! missing source: {rel}", file=sys.stderr)
            continue
        im, alpha = load(rel, args.grid)
        name = f"{work_id}-{args.method}-{args.grid}.png"
        dither(convert(im), alpha).save(out_dir / name, optimize=True)

        size = (out_dir / name).stat().st_size
        manifest[rel] = {"url": f"{args.out}/{name}", "w": im.width, "h": im.height}
        original_total += path.stat().st_size
        derived_total += size
        print(f"  {rel:<24} {path.stat().st_size/1024:8.0f} KB -> {size/1024:5.1f} KB")

    (ROOT / "terminal-manifest.js").write_text(
        "/* Generated by tools/terminal-images.py — do not edit. */\n"
        "const TERMINAL_MANIFEST = " + json.dumps(manifest, separators=(",", ":")) + ";\n"
        'if (typeof window !== "undefined") window.TERMINAL_MANIFEST = TERMINAL_MANIFEST;\n'
    )
    print(f"\n{len(manifest)} works  "
          f"{original_total/1024/1024:.1f} MB -> {derived_total/1024:.0f} KB "
          f"({args.method}, {args.grid}px grid)")


if __name__ == "__main__":
    main()
