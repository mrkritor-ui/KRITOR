#!/usr/bin/env python3
"""KRITOR — responsive image pipeline.

The catalogue is the landing screen, so what it costs to paint is the whole
first impression. This builds, for every artwork and shop image:

  * AVIF and WebP at several widths, so a phone downloads a phone-sized image
    instead of a print-sized one
  * a ~20px LQIP baked into a data URI, so a tile shows the work's colours on
    the very first paint with no network request at all

Output goes to derived/ and image-manifest.js. Nothing is committed — the Pages
workflow runs this at deploy time, so the derivatives can never drift from the
originals and the repo never carries two copies of every painting.

Run locally the same way CI does:

    python3 tools/build-images.py

Add --force to rebuild everything, ignoring the cache.
"""

import base64
import hashlib
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

try:
    import pillow_avif  # noqa: F401  (registers the AVIF plugin with Pillow)
    HAVE_AVIF = True
except ImportError:
    HAVE_AVIF = False

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "derived"
MANIFEST = ROOT / "image-manifest.js"

# Tile widths in CSS pixels top out around 500 on a very wide screen; at 3x DPR
# that is 1500 device pixels. Anything beyond that is invisible detail on a
# grid tile, and the work page has its own larger rendition.
WIDTHS = [240, 480, 960, 1440]

LQIP_WIDTH = 20
QUALITY = {"webp": 80, "avif": 55}

SOURCE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"}


def source_paths():
    """Every image referenced by the catalogue or the store, de-duplicated."""
    wanted = []

    artworks = ROOT / "artworks.js"
    if artworks.exists():
        text = artworks.read_text()
        body = text[text.index("["):text.rindex("]") + 1]
        for entry in json.loads(body):
            if entry.get("image"):
                wanted.append(entry["image"])

    products = ROOT / "products.js"
    if products.exists():
        text = products.read_text()
        for match in re.finditer(r'images:\s*\[(.*?)\]', text, re.S):
            wanted.extend(re.findall(r'"([^"]+)"', match.group(1)))

    seen, out = set(), []
    for rel in wanted:
        rel = rel.lstrip("/")
        if rel in seen:
            continue
        seen.add(rel)
        path = ROOT / rel
        if path.exists() and path.suffix in SOURCE_EXTENSIONS:
            out.append((rel, path))
        elif not path.exists():
            print(f"  ! missing source: {rel}", file=sys.stderr)
    return out


def slug(rel):
    """A filename-safe, URL-safe stem. Originals have spaces and mixed case."""
    return re.sub(r"[^a-z0-9]+", "-", rel.lower().rsplit(".", 1)[0]).strip("-")


def fingerprint(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()[:12]


def lqip_data_uri(im):
    """A tiny blurred stand-in, small enough to inline. Around 300-600 bytes."""
    tiny = im.copy()
    tiny.thumbnail((LQIP_WIDTH, LQIP_WIDTH), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    tiny.save(buffer, "WEBP", quality=40, method=6)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{encoded}"


def build_one(rel, path, force):
    with Image.open(path) as im:
        im = im.convert("RGB")
        native_width, native_height = im.size
        stem = slug(rel)
        digest = fingerprint(path)

        entry = {
            "width": native_width,
            "height": native_height,
            "ratio": round(native_width / native_height, 4) if native_height else 1,
            "lqip": lqip_data_uri(im),
            "webp": [],
            "avif": [],
        }

        formats = [("webp", "WEBP")] + ([("avif", "AVIF")] if HAVE_AVIF else [])

        for width in WIDTHS:
            # Never upscale — a 400px original gains nothing from a 1440 variant.
            if width > native_width and entry["webp"]:
                break
            target = min(width, native_width)
            resized = im.copy()
            resized.thumbnail((target, target * 10), Image.Resampling.LANCZOS)

            for key, pil_format in formats:
                name = f"{stem}-{digest}-{target}.{key}"
                out_path = OUT_DIR / name
                if force or not out_path.exists():
                    save_args = {"quality": QUALITY[key]}
                    if key == "webp":
                        save_args["method"] = 6
                    resized.save(out_path, pil_format, **save_args)
                entry[key].append({"w": resized.width, "url": f"derived/{name}"})

        if not entry["avif"]:
            entry.pop("avif")
        return entry


def main():
    force = "--force" in sys.argv
    OUT_DIR.mkdir(exist_ok=True)

    sources = source_paths()
    if not sources:
        print("No source images found — nothing to do.")
        return

    print(f"Building {len(sources)} images  (avif: {'yes' if HAVE_AVIF else 'no'})")

    manifest, original_total, derived_total = {}, 0, 0
    for rel, path in sources:
        entry = build_one(rel, path, force)
        manifest[rel] = entry
        original_total += path.stat().st_size
        smallest = min(
            (v["url"] for v in entry["webp"]),
            key=lambda u: (ROOT / u).stat().st_size,
        )
        derived_total += (ROOT / smallest).stat().st_size
        print(f"  {rel:<26} {path.stat().st_size/1024:8.0f} KB -> "
              f"{(ROOT / smallest).stat().st_size/1024:6.1f} KB  "
              f"({len(entry['webp'])} widths, lqip {len(entry['lqip'])} B)")

    MANIFEST.write_text(
        "/* Generated by tools/build-images.py at deploy time — do not edit. */\n"
        "const IMAGE_MANIFEST = " + json.dumps(manifest, separators=(",", ":")) + ";\n"
        'if (typeof window !== "undefined") window.IMAGE_MANIFEST = IMAGE_MANIFEST;\n'
    )

    print(f"\nGrid payload at the smallest width: "
          f"{original_total/1024/1024:.1f} MB -> {derived_total/1024:.0f} KB")
    print(f"Manifest: {MANIFEST.stat().st_size/1024:.1f} KB")


if __name__ == "__main__":
    main()
