#!/usr/bin/env python3
"""KRITOR — contextual gallery mockups.

Composites a painting onto an actual reference photo, at its true physical
size, so a viewer gets a real sense of scale instead of a picture floating
in white space. The reference photo carries its own calibration: one person
of known real-world height, visible in frame. From that alone — head-to-
floor pixel height versus real height — the tool derives pixels-per-
centimetre for that specific photo, then hangs every painting centred on
the frame, vertically centred at that person's eye level (≈0.93× their
height, the standard anthropometric ratio) — the way a gallery actually
hangs work, and the same for every painting mocked up against this photo.

    python3 tools/gallery-mockup.py work-21 work-22 \
        --size work-21=70x100 --size work-22=60x60

Sizing comes from artworks.js by default; --size ID=WxH overrides it, or
supplies one for a quick look before the real number is recorded.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent

DEFAULT_PHOTO = ROOT / "tools/gallery-refs/walking-woman.jpg"
DEFAULT_PERSON_HEIGHT_CM = 160
EYE_RATIO = 0.93  # eye height / standing height — standard anthropometric figure


def load_artworks():
    text = (ROOT / "artworks.js").read_text()
    return json.loads(text[text.index("["):text.rindex("]") + 1])


def parse_size(size):
    """'60 × 90 cm' -> (60.0, 90.0); '— × — cm' (unrecorded) -> None."""
    nums = re.findall(r"[\d.]+", size or "")
    if len(nums) < 2:
        return None
    return float(nums[0]), float(nums[1])


def trim_to_canvas(im):
    """The source files are studio photographs of a painting against a
    near-white surround, not tight crops of the canvas — see work-01.png or
    work-07.png. Scaling the whole photo to the recorded size would scale
    that surround right along with it, so the mockup would show the canvas
    smaller than its real cm figure. Trim to the non-white bounding box
    first so what gets sized is the painting itself.

    Guarded on both sides: a background that never differs from white (a
    scan with no surround at all) leaves the box as the full image, and one
    that differs almost everywhere (a photo with no white margin to find, or
    a false match against a pale painting) is treated the same way rather
    than risk cropping into the actual work."""
    rgb = im.convert("RGB")
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, (255, 255, 255))).convert("L")
    bbox = diff.point(lambda p: 255 if p > 20 else 0).getbbox()
    if not bbox:
        return im
    x0, y0, x1, y1 = bbox
    if (x1 - x0) * (y1 - y0) / (im.width * im.height) > 0.985:
        return im
    return im.crop(bbox)


def _design(x, y):
    return np.column_stack([np.ones_like(x), x, y, x ** 2, y ** 2, x * y])


def _fit_background(gray, y0, y1):
    """A smooth quadratic surface fit to one band (wall or floor), reweighted
    away from whatever doesn't fit it. In a room photographed for this
    purpose, that's the calibration figure standing in it — the fit doesn't
    need to know where they are, only that they're the minority."""
    h, w = gray.shape
    ys, xs = np.mgrid[y0:y1, 0:w]
    X, Y = xs.ravel().astype(float), ys.ravel().astype(float)
    Z = gray[y0:y1, :].ravel()
    A = _design(X, Y)
    coef, *_ = np.linalg.lstsq(A, Z, rcond=None)
    for _ in range(3):
        resid = Z - A @ coef
        keep = np.abs(resid) < np.percentile(np.abs(resid), 80)
        coef, *_ = np.linalg.lstsq(A[keep], Z[keep], rcond=None)
    resid = Z - A @ coef
    sigma = resid[np.abs(resid) < np.percentile(np.abs(resid), 80)].std()
    return coef, sigma


def calibrate(photo, person_height_cm):
    """Pixels-per-centimetre for this photo, plus the row a painting should
    be centred on to land at the calibration figure's eye level.

    A flat background assumption doesn't hold here — a real vignette runs
    through this kind of shot, darker at the edges than the centre — so a
    naive "differs from a clean patch" test flags half the wall as
    foreground. Fitting the wall and floor as smooth surfaces instead (see
    _fit_background) and reweighting away the outliers isolates the one
    thing that doesn't belong to either surface: the person."""
    blurred = photo.convert("RGB").filter(ImageFilter.GaussianBlur(4))
    arr = np.asarray(blurred).astype(np.float64)
    h, w, _ = arr.shape
    gray = arr.mean(axis=2)

    # floor line: the sharpest step in a row-wise 75th-percentile profile,
    # which a minority foreground figure barely shifts
    row_robust = np.percentile(gray, 75, axis=1)
    d = np.abs(np.diff(row_robust))
    lo, hi = int(h * 0.3), int(h * 0.9)
    floor_y = lo + int(np.argmax(d[lo:hi]))

    wall_coef, wall_sigma = _fit_background(gray, 0, floor_y)
    floor_coef, floor_sigma = _fit_background(gray, floor_y, h)

    ys, xs = np.mgrid[0:h, 0:w]
    A_full = _design(xs.ravel().astype(float), ys.ravel().astype(float))
    wall_pred = (A_full @ wall_coef).reshape(h, w)
    floor_pred = (A_full @ floor_coef).reshape(h, w)
    bg_pred = np.where(ys < floor_y, wall_pred, floor_pred)

    diff = np.abs(gray - bg_pred)
    sigma = max(wall_sigma, floor_sigma)
    mask = diff > sigma * 6

    mys, _ = np.where(mask)
    if len(mys) < 50:
        raise ValueError("couldn't find a calibration figure standing in this photo")
    head_top_y = int(np.percentile(mys, 0.5))  # trims stray outlier pixels, not just min()

    person_height_px = floor_y - head_top_y
    ppcm = person_height_px / person_height_cm
    eye_y = round(floor_y - EYE_RATIO * person_height_cm * ppcm)

    return dict(floor_y=floor_y, ppcm=ppcm, eye_y=eye_y,
                person_height_px=person_height_px, head_top_y=head_top_y)


def _blurred_rect(img, box, blur, opacity):
    x0, y0, x1, y1 = box
    pad = int(blur * 2.2) + 4
    layer = Image.new("RGBA", (int(x1 - x0) + pad * 2, int(y1 - y0) + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle([pad, pad, layer.width - pad, layer.height - pad],
                                     fill=(15, 14, 12, opacity))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    img.paste(layer, (int(x0) - pad, int(y0) - pad), layer)


def composite(photo, painting_path, w_cm, h_cm, ppcm, cx, eye_y):
    w_px = max(1, round(w_cm * ppcm))
    h_px = max(1, round(h_cm * ppcm))

    with Image.open(painting_path) as src:
        src = src.convert("RGBA") if src.mode in ("RGBA", "LA") or (
            src.mode == "P" and "transparency" in src.info) else src.convert("RGB")
        if src.mode == "RGBA":
            flat = Image.new("RGB", src.size, (255, 255, 255))
            flat.paste(src, (0, 0), src)
            src = flat
        src = trim_to_canvas(src)
        painting = ImageOps.fit(src, (w_px, h_px), Image.Resampling.LANCZOS, centering=(0.5, 0.5))

    out = photo.convert("RGB").copy()
    left = round(cx - w_px / 2)
    top = round(eye_y - h_px / 2)

    # a soft shadow mostly hidden behind the work, showing only below it
    _blurred_rect(out,
                  (left - w_px * 0.03, top + h_px * 0.3,
                   left + w_px * 1.03, top + h_px + h_px * 0.08),
                  blur=max(10, w_px * 0.045), opacity=70)

    out.paste(painting, (left, top))
    ImageDraw.Draw(out, "RGBA").rectangle(
        [left, top, left + w_px - 1, top + h_px - 1], outline=(20, 18, 14, 60), width=1)
    # The painting's own pixel rect within this mockup — the site's "View on
    # wall" transition reads this (scaled to the mockup <img>'s rendered
    # size) to land the artwork exactly on the wall, so it rides along with
    # the image rather than needing to be worked out again by hand.
    rect = {"x": left, "y": top, "w": w_px, "h": h_px}
    return out, rect


def parse_size_arg(value):
    id_, _, dims = value.partition("=")
    m = re.match(r"^\s*([\d.]+)\s*[x×]\s*([\d.]+)\s*$", dims, re.I)
    if not id_ or not m:
        raise argparse.ArgumentTypeError(
            f"--size must be ID=WxH, e.g. work-21=70x100 (got {value!r})")
    return id_, (float(m.group(1)), float(m.group(2)))


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ids", nargs="*",
                         help="work ids to render (default: every work with a recorded size)")
    parser.add_argument("--size", action="append", default=[], type=parse_size_arg,
                         metavar="ID=WxH",
                         help="override or supply a size in cm, e.g. work-21=70x100")
    parser.add_argument("--photo", default=str(DEFAULT_PHOTO),
                         help="reference photo to composite onto")
    parser.add_argument("--person-height", type=float, default=DEFAULT_PERSON_HEIGHT_CM,
                         help="real height in cm of the calibration figure in --photo (default 160)")
    parser.add_argument("--out", default="derived-gallery")
    args = parser.parse_args()

    overrides = dict(args.size)

    works = load_artworks()
    if args.ids:
        wanted = set(args.ids)
        found = {w["id"]: w for w in works if w["id"] in wanted}
        for missing in wanted - found.keys():
            print(f"  ! unknown work id: {missing}", file=sys.stderr)
        works = [found[i] for i in args.ids if i in found]

    photo_path = Path(args.photo)
    if not photo_path.is_absolute():
        photo_path = ROOT / photo_path
    photo = Image.open(photo_path)
    cal = calibrate(photo, args.person_height)
    print(f"calibrated against {photo_path.relative_to(ROOT)}: "
          f"{args.person_height:g}cm figure = {cal['person_height_px']}px tall "
          f"-> {cal['ppcm']:.3f} px/cm  (floor y={cal['floor_y']}, eye level y={cal['eye_y']})\n")

    out_dir = ROOT / args.out
    out_dir.mkdir(exist_ok=True)

    rendered = 0
    for work in works:
        dims = overrides.get(work["id"]) or parse_size(work.get("size", ""))
        if not dims:
            print(f"  - {work['id']:<10} skipped (no recorded size — pass --size {work['id']}=WxH)")
            continue
        w_cm, h_cm = dims
        image_path = ROOT / work["image"]
        if not image_path.exists():
            print(f"  ! missing source: {work['image']}", file=sys.stderr)
            continue

        out_path = out_dir / f"{work['id']}-context.png"
        image, rect = composite(photo, image_path, w_cm, h_cm, cal["ppcm"], photo.width / 2,
                                 cal["eye_y"])
        image.save(out_path)
        (out_dir / f"{work['id']}-context.json").write_text(json.dumps(rect))
        rendered += 1
        print(f"  {work['id']:<10} {w_cm:g} × {h_cm:g} cm  "
              f"rect=({rect['x']},{rect['y']},{rect['w']},{rect['h']})  ->  "
              f"{out_path.relative_to(ROOT)}")

    print(f"\n{rendered} contextual mockup(s) written to {out_dir.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
