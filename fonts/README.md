# fonts/

## pix Chicago — `pix-chicago.woff2`

The site face. Everything that is not a heading is set in it: the bar, the
catalogue, the work panels, the bag, the checkout.

- **Designer:** Etienne Desclides (`atn.`), version 1.00.
- **What it is:** a bitmap redraw of Chicago — Susan Kare's system font for the
  first Macintosh, and later the face of the iPod — which is why it belongs on
  a site that is pretending to be a machine from that era.
- **Source:** <https://www.dafont.com/pix-chicago.font>, listed there as
  100% free. The original release is `pixChicago.ttf`; it is not on Google
  Fonts, so it is served from this origin instead.

### How the `.woff2` was made

The original TrueType, compressed to WOFF2 with `fontTools` — 30 KB down to
4.4 KB. Outlines, widths and metrics are the author's, untouched. Two changes
only, both repairs:

- The glyph mapped to U+0100 (`Ā`, unused here) carries two bytes of junk where
  a ten-byte header should be, and no WOFF2 encoder will accept it. It is
  blanked and its mapping dropped, so the browser falls back for that one
  character.
- Nothing else. The size and line-box adjustments live in CSS
  (`size-adjust`, `ascent-override`, `descent-override` in `terminal.css` and
  `type.css`), not in the file, so the font stays the font the author shipped.

```python
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph

f = TTFont("pixChicago.ttf")
f["glyf"].glyphs["glyph00226"] = Glyph()          # U+0100, malformed
for t in f["cmap"].tables:
    t.cmap.pop(0x100, None)
f.flavor = "woff2"
f.save("pix-chicago.woff2", reorderTables=False)
```

### What it does and does not cover

Latin-1 plus the usual typographic set (curly quotes, dashes, bullet, ellipsis,
`©`, `™`, `×`). It has no box-drawing characters — the `─` runs in this
codebase are all in source comments, not in anything rendered — and no `−`
(U+2212), which the quantity steppers use and which falls back to the system
mono. Digits are proportional, not tabular: `1` is three pixels wide where `0`
is seven, which is how Chicago was drawn.

## The remaining hosted faces

Headings only, still from Google Fonts: **Jacquarda Bastarda 9** (a work's own
name, and KRITOR's voice on the boot screens) and **VT323** (item names on the
shopfront). Both are loaded through the async `<link>` in each page's head.
