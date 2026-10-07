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

## Jacquarda Bastarda 9 and VT323

Headings only: **Jacquarda Bastarda 9** (a work's own name, and KRITOR's voice
on the boot screens) and **VT323** (item names on the shopfront).

| Face | Designer | Licence | Files |
|---|---|---|---|
| Jacquarda Bastarda 9 | Sarah Cadigan-Fried (The Soft Type Project) | SIL OFL 1.1 | `jacquarda-bastarda-9-latin.woff2`, `-latin-ext.woff2`, `OFL-jacquarda-bastarda-9.txt` |
| VT323 | Peter Hull | SIL OFL 1.1 | `vt323-latin.woff2`, `-latin-ext.woff2`, `OFL-vt323.txt` |

These used to be loaded from Google Fonts. They are served from this origin now
because a request to Google in front of every work's name is a third party the
site does not need — and, for a visitor in Europe, a transfer of their address
to Google that a privacy policy would have to explain, and that the Munich
Regional Court held unlawful without consent in 2022. The `@font-face` rules are in
`terminal.css`.

The `.woff2` files are exactly what Google Fonts serves for the `latin` and
`latin-ext` unicode-range subsets, unmodified, which is what the OFL allows
provided the copyright notice and licence travel with them (the two `OFL-*.txt`
files). Characters outside those subsets — the maths and symbol blocks —
fall back to the next face in the stack. To refresh them:

```sh
curl -A "Mozilla/5.0 Chrome/130" \
  "https://fonts.googleapis.com/css2?family=Jacquarda+Bastarda+9&family=VT323&display=swap"
# then download the woff2 named under each /* latin */ and /* latin-ext */ block
```

### `tools/pix-chicago.ttf`

The same outlines as the `.woff2` above, saved as TrueType. It is not served —
`tools/build-og.py` draws the social share cards with it, because Pillow reads
TrueType but not WOFF2. If the `.woff2` is ever redone, redo this from the same
file: `TTFont("pix-chicago.woff2")`, `flavor = None`, save.
