# AR overrides

**You almost certainly don't need to put anything here.**

AR is generated from the artwork's own catalogue image. To give a work an AR
view, set its dimensions in `artworks.js` and that's it:

```js
"ar": { "enabled": true, "file": "ar/work-05.usdz", "width": 70, "height": 90 }
```

`width` and `height` are the real painting in **centimetres** — they are what
makes it appear at the right size on someone's wall, so they have to be right.
With `enabled: true` and no dimensions the build fails rather than shipping a
button that does nothing.

## When to put a file here

Only when the AR texture should genuinely differ from the catalogue image:

- the catalogue photo includes the studio floor or a frame you don't want
  floating on someone's wall
- the catalogue photo is at an angle and you have a straightened version
- the work is photographed in situ but you want it isolated for AR

Name it after the artwork id — `work-05.png` — and it wins over the catalogue
image. Any of png / jpg / jpeg / webp.

## Transparent PNGs

Upload a good PNG and it comes out the other side intact. Whatever transparency
it has is what appears on the wall.

Nothing inspects the picture, guesses at a background, or crops anything. The
only question asked is whether the alpha channel holds anything other than
"fully opaque" — a channel that is uniformly opaque encodes nothing, so it is
dropped and the texture ships as a much smaller JPEG. That is the same rule the
web renditions follow.

The work is always a single flat plane. There is no branch on what the picture
looks like, and no box behind it that a cutout would reveal.

One thing to expect: ARKit accepts only PNG or JPEG textures, and only PNG
carries alpha — so a genuinely transparent work produces a noticeably larger
`.usdz` than an opaque one (a few MB rather than a few hundred KB). If that
becomes a problem, `MAX_TEXTURE` in `scripts/generate_usdz.py` is the dial.

## Rebuilding

`.github/workflows/generate-ar.yml` runs on any push touching `images/`,
`artworks.js` or `scripts/`, and commits the `.usdz` files back. You can also
run it by hand from the Actions tab, or locally:

```bash
pip install usd-core pillow
python scripts/generate_usdz.py
```

Textures are capped at 2048px. A USDZ is downloaded over mobile data the moment
someone taps "View in AR", and past that size the extra detail is invisible at
arm's length.
