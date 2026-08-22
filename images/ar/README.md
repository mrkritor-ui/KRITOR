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

When a source has a real transparent background, the build makes the painting a
flat cutout: alpha drives opacity, and the shallow canvas body behind it is
omitted, so the shape of the work is what lands on the wall rather than a
rectangle. An opaque source keeps the canvas body, which is what makes a
rectangular painting read as an object rather than a sticker.

Nothing to configure — it's decided from the image.

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
