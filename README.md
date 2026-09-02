# KRITOR

The catalogue and store at **kritor.au**. A static site — no build step to run
locally, no dependencies to install to look at it.

## Branches

| Branch | What it is |
|---|---|
| `claude/terminal-redesign-sar634` | **The live site.** Every push deploys. |
| `redesign/catalogue-v2` | The old catalogue, kept as an archive. Not deployed. |

The archive branch's head (`419c1bc`) is an ancestor of the live branch, so the
old catalogue is still in this history — `git show 419c1bc` reaches it. It no
longer publishes, because both branches deployed to the same Pages site and a
push to the old one would have replaced the new.

## Looking at it locally

```sh
python3 -m http.server 8899          # then open http://127.0.0.1:8899/
```

Two things the deploy builds that a fresh clone does not have:

```sh
pip install Pillow pillow-avif-plugin numpy
python3 tools/build-images.py        # responsive renditions + image-manifest.js
python3 tools/terminal-images.py     # 1-bit renditions + terminal-manifest.js
```

Without them the pages still work — tiles fall back to the original images —
but the catalogue downloads megabytes instead of kilobytes.

Deep links (`/work-01/`) need their directories, which the deploy also writes:

```sh
node -e 'const fs=require("fs"),p=require("path");const s=fs.readFileSync("artworks.js","utf8");
JSON.parse(s.slice(s.indexOf("["),s.lastIndexOf("]")+1)).forEach(w=>{fs.mkdirSync(w.id,{recursive:true});
fs.writeFileSync(p.join(w.id,"index.html"),fs.readFileSync("index.html"))});'
```

## How it fits together

```
index.html          the catalogue
store/index.html    the shopfront
checkout/index.html the checkout — Stripe, its own CSP

terminal-shell.js   the chrome both pages share: theme, bar, boot
                    sequence, typing, screensaver
terminal.js         the catalogue: views, filters, the work panel
terminal-store.js   the store: tiles, the bag, add to bag
terminal.css        the whole visual system
cursor.css          the drawn cursor, shared by every page including checkout

cart.js             cart state and Stripe plumbing. Untouched by the
                    redesign; the terminal pages use it as state only
                    (it injects its own drawer only for pages that
                    provide [data-bag-slot], and they do not)
```

### Two rules worth knowing before editing

**Asset URLs carry `?v=__ASSET_VERSION__`.** The deploy replaces the token, the
same way it stamps `sw.js`. Hand-numbered versions are how a change ships and
nobody is served it — that happened for seven deploys.

**Type is pix Chicago, except a work's own name**, which is Jacquarda
Bastarda 9 (VT323 on the shopfront). pix Chicago is served from `fonts/` —
see the README there for where it came from and what it covers. Anything
outside those faces' character sets silently falls back and breaks the pixel
grid, so check a glyph exists before using it: pix Chicago is Latin-1 plus the
usual punctuation, with no box-drawing characters and no `−` (U+2212).

## Adding work

Edit `artworks.js`. `format` and `materials` are optional and default in one
place each, so filling them in later is a data change and nothing else.

```js
{
  id: "work-18",              // becomes /work-18/
  title: "Untitled",
  year: 2026,
  collection: "Studio Series", // the SERIES filter, "" for uncollected
  size: "60 × 90 cm",
  materials: "Mixed media on canvas",
  format: "Painting",
  image: "images/work-18.png",
  ar: { enabled: false, file: "ar/work-18.usdz", width: 0, height: 0 }
}
```

Items for sale are separate — see `products.js` and `shop/README.md`. The
catalogue is the whole archive; the store is only what is for sale.
