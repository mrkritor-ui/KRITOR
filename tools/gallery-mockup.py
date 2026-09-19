#!/usr/bin/env python3
"""KRITOR — contextual gallery mockups.

A painting on its own, on a white catalogue background, tells a buyer
nothing about how big it actually is. This drops each work into the same
plain room — white wall, polished concrete floor, one wooden chair — sized
from its own `size` field in artworks.js, so the chair reads as a constant
scale reference across the whole set: a viewer can compare any two mockups
and trust that a taller painting really is taller, not just zoomed
differently.

Two shots, each consistent with itself across every work:

    medium   a close, tight crop — the painting dominates the frame, the
             chair sits right beside it. For a product page or a close look.
    long     a wide, establishing room shot — more wall, more floor, a
             grid-lit ceiling — the painting read at a human distance,
             the way it would actually hang.

There is no photographed room behind either one — nothing in the repo has
one, and re-shooting a physical studio corner every time a painting is added
does not scale. The scene is drawn instead: flat, minimal, and cheap to
regenerate exactly the same way for work #40 as for work #1.

The one rule that makes the scale reference mean anything: PPCM (pixels per
real-world centimetre) is the same for every image in a set, medium or long.
Canvas size grows to fit each painting and each shot's framing; PPCM does not.

    python3 tools/gallery-mockup.py                 # every work with a recorded size, both shots
    python3 tools/gallery-mockup.py work-01 work-05  # just these
    python3 tools/gallery-mockup.py --shot long      # only the wide shot
    python3 tools/gallery-mockup.py --ppcm 5 --out derived-gallery
"""

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent

PPCM_DEFAULT = 4.0  # pixels per real-world centimetre

# The chair. One reference object, drawn the same way and at the same real
# size in every scene — a side profile, since that is the one view of a
# chair a silhouette can't get ambiguous about.
CHAIR_HEIGHT_CM = 82       # floor to top of backrest
CHAIR_SEAT_HEIGHT_CM = 45  # floor to seat
CHAIR_SEAT_DEPTH_CM = 40   # front-to-back footprint

HANG_CENTER_CM = 152  # floor to a painting's visual centre — standard gallery hang height

# Layout differs between the two shots (how much of the room a "camera" this
# close or this far back would actually include); PPCM and every real-world
# cm figure above stays identical between them, which is what keeps the
# chair meaning the same thing in both.
SHOTS = {
    "medium": dict(top_margin=90, floor_depth=150, left_margin=70, chair_gap=60,
                    right_margin=100, min_w=900, ceiling=False, reflect=90),
    "long": dict(top_margin=230, floor_depth=380, left_margin=170, chair_gap=150,
                  right_margin=230, min_w=1500, ceiling=True, reflect=220),
}

WALL_TOP = np.array([249, 248, 246])
WALL_BOTTOM = np.array([238, 237, 233])
FLOOR_FAR = np.array([200, 199, 195])
FLOOR_NEAR = np.array([166, 165, 160])

WOOD = (156, 108, 63)
WOOD_LIGHT = (181, 133, 85)
WOOD_DARK = (112, 74, 40)

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


def load_artworks():
    text = (ROOT / "artworks.js").read_text()
    return json.loads(text[text.index("["):text.rindex("]") + 1])


def parse_size(size):
    """'60 × 90 cm' -> (60.0, 90.0); '— × — cm' (unrecorded) -> None."""
    nums = re.findall(r"[\d.]+", size or "")
    if len(nums) < 2:
        return None
    return float(nums[0]), float(nums[1])


def load_font(size):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render_background(w, h, floor_y):
    """The room: a soft vertical gradient wall, a polished concrete floor,
    both at whatever width this particular painting and shot need. Grain
    uses a fixed seed so every mockup in a set reads as the same room, not a
    fresh one."""
    y = np.arange(h).reshape(-1, 1)
    t_wall = np.clip(y / max(floor_y, 1), 0, 1)
    wall_rgb = WALL_TOP * (1 - t_wall) + WALL_BOTTOM * t_wall
    t_floor = np.clip((y - floor_y) / max(h - floor_y, 1), 0, 1)
    floor_rgb = FLOOR_FAR * (1 - t_floor) + FLOOR_NEAR * t_floor
    rows = np.where(y < floor_y, wall_rgb, floor_rgb)
    img = np.broadcast_to(rows[:, None, :], (h, w, 3)).astype(np.float64).copy()

    rng = np.random.default_rng(0)
    grain = np.asarray(
        Image.fromarray(rng.normal(128, 30, size=(h, w)).clip(0, 255).astype(np.uint8), "L")
        .filter(ImageFilter.GaussianBlur(1.4))
    ).astype(np.float64)
    grain = (grain - 128) / 128.0
    floor_mask = (y >= floor_y).astype(np.float64)
    img += (grain * 6.0)[:, :, None] * floor_mask[:, :, None]
    img += (grain * 1.6)[:, :, None] * (1 - floor_mask)[:, :, None]

    # gentle vignette so the room has depth instead of reading as flat paint
    xs = (np.arange(w) - w / 2) / (w / 2)
    ys = (np.arange(h) - h / 2) / (h / 2)
    dist = np.sqrt(xs[None, :] ** 2 + ys[:, None] ** 2)
    img -= (np.clip(dist - 0.6, 0, 1) * 10.0)[:, :, None]

    bg = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")

    draw = ImageDraw.Draw(bg, "RGBA")
    for i in range(28):
        draw.line([(0, floor_y - i), (w, floor_y - i)], fill=(60, 55, 45, max(0, 6 - i // 5)))
    draw.line([(0, floor_y), (w, floor_y)], fill=(150, 145, 135, 120))
    return bg


def draw_ceiling(bg, w, band_h):
    """A grid of recessed light panels along the top edge, the way a real
    white-cube gallery is lit — long shots show enough of the room for it to
    register; medium shots crop too tight for it to read, so they skip it."""
    draw = ImageDraw.Draw(bg, "RGBA")
    draw.rectangle([0, 0, w, band_h], fill=(253, 253, 252))
    cols = max(4, round(w / 150))
    col_w = w / cols
    for i in range(cols):
        x0 = i * col_w
        draw.rectangle([x0 + 5, 7, x0 + col_w - 5, band_h - 12], fill=(255, 255, 255))
        draw.rectangle([x0 + 5, 7, x0 + col_w - 5, band_h - 12], outline=(221, 219, 213), width=1)
    spill = 90
    for i in range(spill):
        alpha = int(46 * (1 - i / spill))
        draw.line([(0, band_h + i), (w, band_h + i)], fill=(255, 255, 255, alpha))


def add_reflection(bg, floor_y, reflect_h):
    """A faint, softened mirror of the wall just above the floor line, faded
    out with distance — the sheen a polished concrete slab actually has."""
    reflect_h = min(reflect_h, bg.height - floor_y)
    if reflect_h <= 4:
        return
    above = bg.crop((0, max(0, floor_y - reflect_h), bg.width, floor_y))
    flipped = ImageOps.flip(above).filter(ImageFilter.GaussianBlur(3))
    fade = np.linspace(95, 0, flipped.height).astype(np.uint8)
    alpha = Image.fromarray(np.tile(fade.reshape(-1, 1), (1, flipped.width)), "L")
    flipped.putalpha(alpha)
    bg.alpha_composite(flipped.convert("RGBA"), (0, floor_y)) if bg.mode == "RGBA" else \
        bg.paste(flipped, (0, floor_y), flipped)


def draw_shadow(draw_img, box, blur, opacity):
    """A soft contact shadow, composited straight into the scene so the floor
    or wall grain shows through it, then blurred in its own small buffer."""
    x0, y0, x1, y1 = box
    pad = int(blur * 2.2) + 4
    layer = Image.new("RGBA", (int(x1 - x0) + pad * 2, int(y1 - y0) + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([pad, pad, layer.width - pad, layer.height - pad],
                                   fill=(20, 18, 14, opacity))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    draw_img.paste(layer, (int(x0) - pad, int(y0) - pad), layer)


def draw_chair(bg, foot_x, floor_y, ppcm):
    """A side-profile wooden chair. foot_x is the left edge of its footprint."""
    depth = CHAIR_SEAT_DEPTH_CM * ppcm
    seat_h = CHAIR_SEAT_HEIGHT_CM * ppcm
    total_h = CHAIR_HEIGHT_CM * ppcm
    leg_w = max(4, depth * 0.10)
    seat_thick = max(6, seat_h * 0.11)

    back_top = floor_y - total_h
    seat_y = floor_y - seat_h

    draw_shadow(bg, (foot_x - depth * 0.15, floor_y - depth * 0.12,
                      foot_x + depth * 1.15, floor_y + depth * 0.22),
                blur=max(6, depth * 0.14), opacity=70)

    draw = ImageDraw.Draw(bg, "RGBA")

    # back post (also the rear leg, seen from the side)
    draw.rectangle([foot_x, back_top, foot_x + leg_w, floor_y], fill=WOOD_DARK)
    # front leg
    draw.rectangle([foot_x + depth - leg_w, seat_y, foot_x + depth, floor_y], fill=WOOD)
    # stretcher rail between the legs
    rail_y = seat_y + (floor_y - seat_y) * 0.55
    draw.line([(foot_x + leg_w * 0.5, rail_y), (foot_x + depth - leg_w * 0.5, rail_y)],
               fill=WOOD_DARK, width=max(2, int(leg_w * 0.5)))
    # backrest slab, sitting on the back post
    back_w = leg_w * 2.0
    draw.rounded_rectangle([foot_x - leg_w * 0.25, back_top, foot_x + back_w, seat_y],
                            radius=max(2, leg_w * 0.4), fill=WOOD)
    for slat in (0.32, 0.62):
        sy = back_top + (seat_y - back_top) * slat
        draw.line([(foot_x - leg_w * 0.1, sy), (foot_x + back_w - leg_w * 0.1, sy)],
                   fill=WOOD_DARK, width=max(1, int(leg_w * 0.22)))
    # seat slab, on top of both legs
    draw.rounded_rectangle([foot_x - leg_w * 0.25, seat_y - seat_thick / 2,
                             foot_x + depth, seat_y + seat_thick / 2],
                            radius=max(2, seat_thick * 0.3), fill=WOOD_LIGHT)
    draw.line([(foot_x - leg_w * 0.25, seat_y + seat_thick / 2 - 1),
               (foot_x + depth, seat_y + seat_thick / 2 - 1)], fill=WOOD_DARK, width=1)

    return depth


def trim_to_canvas(im):
    """The source files are studio photographs of a painting against a
    near-white surround, not tight crops of the canvas — see work-01.png or
    work-07.png. Scaling the whole photo to the recorded size would scale
    that surround right along with it, so every mockup would show the canvas
    smaller than its real cm figure. Trim to the non-white bounding box first
    so what gets sized is the painting itself.

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
    area_kept = (x1 - x0) * (y1 - y0) / (im.width * im.height)
    if area_kept > 0.985:
        return im
    return im.crop(bbox)


def mount_painting(bg, image_path, cx, floor_y, w_cm, h_cm, ppcm):
    w_px = max(1, round(w_cm * ppcm))
    h_px = max(1, round(h_cm * ppcm))

    with Image.open(image_path) as src:
        src = src.convert("RGBA") if src.mode in ("RGBA", "LA") or (
            src.mode == "P" and "transparency" in src.info) else src.convert("RGB")
        if src.mode == "RGBA":
            flat = Image.new("RGB", src.size, (255, 255, 255))
            flat.paste(src, (0, 0), src)
            src = flat
        src = trim_to_canvas(src)
        painting = ImageOps.fit(src, (w_px, h_px), Image.Resampling.LANCZOS, centering=(0.5, 0.5))

    left = round(cx - w_px / 2)
    top = round(floor_y - HANG_CENTER_CM * ppcm - h_px / 2)

    shadow_offset = max(5, round(min(w_px, h_px) * 0.02))
    draw_shadow(bg,
                (left + shadow_offset, top + shadow_offset,
                 left + w_px + shadow_offset, top + h_px + shadow_offset),
                blur=max(8, min(w_px, h_px) * 0.03), opacity=90)

    bg.paste(painting, (left, top))
    ImageDraw.Draw(bg, "RGBA").rectangle(
        [left, top, left + w_px - 1, top + h_px - 1], outline=(20, 18, 14, 45), width=1)

    return left, top, w_px, h_px


def caption(bg, text, y):
    font = load_font(22)
    draw = ImageDraw.Draw(bg)
    box = draw.textbbox((0, 0), text, font=font)
    x = (bg.width - (box[2] - box[0])) / 2
    draw.text((x, y), text, font=font, fill=(126, 123, 116))


def compose(work, w_cm, h_cm, image_path, ppcm, with_caption, shot):
    layout = SHOTS[shot]
    painting_w = w_cm * ppcm
    painting_h = h_cm * ppcm
    chair_w = CHAIR_SEAT_DEPTH_CM * ppcm
    chair_h = CHAIR_HEIGHT_CM * ppcm

    canvas_w = max(layout["min_w"], layout["left_margin"] + chair_w + layout["chair_gap"]
                    + painting_w + layout["right_margin"])
    group_w = chair_w + layout["chair_gap"] + painting_w
    group_left = (canvas_w - group_w) / 2 if canvas_w > layout["min_w"] else layout["left_margin"]

    chair_top_offset = chair_h
    painting_top_offset = HANG_CENTER_CM * ppcm + painting_h / 2
    floor_y = round(layout["top_margin"] + max(chair_top_offset, painting_top_offset))
    canvas_h = round(floor_y + layout["floor_depth"] + (60 if with_caption else 0))

    bg = render_background(round(canvas_w), canvas_h, floor_y)

    if layout["ceiling"]:
        draw_ceiling(bg, round(canvas_w), min(layout["top_margin"] - 40, 130))

    chair_x = group_left
    draw_chair(bg, chair_x, floor_y, ppcm)

    painting_cx = group_left + chair_w + layout["chair_gap"] + painting_w / 2
    mount_painting(bg, image_path, painting_cx, floor_y, w_cm, h_cm, ppcm)

    add_reflection(bg, floor_y, layout["reflect"])

    if with_caption:
        label = work.get("title") or work["id"]
        caption(bg, f"{label}  ·  {w_cm:g} × {h_cm:g} cm", floor_y + layout["floor_depth"] + 18)

    return bg


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ids", nargs="*",
                         help="work ids to render (default: every work with a recorded size)")
    parser.add_argument("--shot", choices=["medium", "long", "both"], default="both")
    parser.add_argument("--out", default="derived-gallery")
    parser.add_argument("--ppcm", type=float, default=PPCM_DEFAULT,
                         help="pixels per centimetre (default 4) — keep it fixed across a "
                              "set, the chair is only a true scale reference if it doesn't change")
    parser.add_argument("--caption", action=argparse.BooleanOptionalAction, default=True,
                         help="print title and size under the scene (default on)")
    args = parser.parse_args()

    works = load_artworks()
    if args.ids:
        wanted = set(args.ids)
        found = {w["id"]: w for w in works if w["id"] in wanted}
        for missing in wanted - found.keys():
            print(f"  ! unknown work id: {missing}", file=sys.stderr)
        works = [found[i] for i in args.ids if i in found]

    shots = ["medium", "long"] if args.shot == "both" else [args.shot]

    out_dir = ROOT / args.out
    out_dir.mkdir(exist_ok=True)

    rendered = 0
    for work in works:
        dims = parse_size(work.get("size", ""))
        if not dims:
            print(f"  - {work['id']:<10} skipped (no recorded size)")
            continue
        w_cm, h_cm = dims
        image_path = ROOT / work["image"]
        if not image_path.exists():
            print(f"  ! missing source: {work['image']}", file=sys.stderr)
            continue

        for shot in shots:
            out_path = out_dir / f"{work['id']}-{shot}.png"
            compose(work, w_cm, h_cm, image_path, args.ppcm, args.caption, shot).save(out_path)
            rendered += 1
            print(f"  {work['id']:<10} {shot:<7} {w_cm:g} × {h_cm:g} cm  ->  "
                  f"{out_path.relative_to(ROOT)}")

    print(f"\n{rendered} gallery mockup(s) written to {out_dir.relative_to(ROOT)}/"
          f"  (ppcm {args.ppcm:g})")


if __name__ == "__main__":
    main()
