"""KRITOR — where the work is in a photograph of it.

Shared by the tools that need a painting at its own proportions rather than the
export canvas's: tools/terminal-images.py (the grid's tile shapes) and
tools/build-og.py (the social share cards). Run as scripts from this folder, so
both import it as `trim`.
"""

from PIL import ImageChops


def content_bbox(im, alpha):
    """The rectangle actually holding the work, trimmed of whatever studio
    wall or transparent margin the export happened to include.

    Without this, the grid's aspect-ratio comes from the export canvas —
    several of these are square Instagram-style crops around a portrait or
    landscape painting — and the tile ends up the canvas's shape, not the
    work's: a stubby square standing next to correctly-proportioned
    neighbours, with the actual painting shrunk into a corner of it."""
    if alpha.getextrema()[0] < 250:
        # Real transparency already marks where the work is.
        mask = alpha.point(lambda v: 255 if v > 10 else 0)
    else:
        # Fully opaque: the studio wall around a photographed canvas reads as
        # flat near-white, which the 1-bit conversion fades out anyway and
        # which nobody wants round a share card either — so trim it here.
        mask = ImageChops.invert(im.convert("L")).point(lambda v: 255 if v > 8 else 0)
    return mask.getbbox() or (0, 0, im.width, im.height)
