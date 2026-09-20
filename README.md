# KRITOR

The catalogue and store at **kritor.au**. A static site — no build step to run
locally, no dependencies to install to look at it.

## Branches

The deploy triggers on `main` and on `redesign/catalogue-v2` — both names are
listed in `.github/workflows/pages.yml` because the default branch is mid-rename
to `main`, and a trigger that is only correct after somebody remembers to click
something is a site that quietly stops deploying. Drop the old name from that
list once the rename is through.

The old catalogue's head (`419c1bc`) is an ancestor of this history, so it is
still reachable — `git show 419c1bc`.

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

A third tool is never run by the deploy — it's for sharing a work off-site
with a sense of its actual size:

```sh
python3 tools/gallery-mockup.py                 # every work with a recorded size
python3 tools/gallery-mockup.py work-01 work-05  # just these
python3 tools/gallery-mockup.py work-21 --size work-21=70x100  # no recorded size yet
```

Composites each work onto the reference photo at `tools/gallery-refs/`, at
its true physical size, centred on the frame and hung at the calibration
figure's eye level. The photo carries its own scale: the tool measures that
figure's pixel height against their real height (`--person-height`, default
160cm) and derives pixels-per-centimetre from it, so every painting mocked
up against the same photo is in true relative scale to every other one.
Writes `<id>-context.png` to `derived-gallery/` — see the tool's own
docstring for how the calibration works and for `--photo`.

Without them the pages still work — tiles fall back to the original images —
but the catalogue downloads megabytes instead of kilobytes.

Deep links (`/work-01/`) need their directories, which the deploy also writes:

```sh
node -e 'const fs=require("fs"),p=require("path");const s=fs.readFileSync("artworks.js","utf8");
JSON.parse(s.slice(s.indexOf("["),s.lastIndexOf("]")+1)).forEach(w=>{fs.mkdirSync(w.id,{recursive:true});
fs.writeFileSync(p.join(w.id,"index.html"),fs.readFileSync("work.html"))});'
```

The same build step also bakes each work's and shop item's own `<title>`,
description, canonical link, Open Graph/Twitter tags, and JSON-LD directly
into its generated `index.html` (see `.github/workflows/pages.yml`), and
writes `sitemap.xml` from the same data. A fresh clone's `/work-01/` and
`/shop/<id>/` carry only the generic template's tags until that build runs.

## How it fits together

```
index.html          the landing door — the bar and its three options
                    (ART, ARCHITECTURE, STORE), no scene behind it
landing.css/.js     the door's own layout and its click-to-loading-to-
                    navigate behaviour; the rest it borrows from terminal.css
art/index.html      the catalogue
architecture/index.html  the same catalogue rule system — views, filters,
                    the bar — wired against an empty ARTWORKS, since there
                    is no work to show here yet. Its own boot scene (the
                    signal) instead of the catalogue's (the mosaic).
store/index.html    the shopfront
checkout/index.html the checkout — Stripe, its own CSP

terminal-shell.js   the chrome every terminal page shares: theme, bar, boot
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

### Three rules worth knowing before editing

**Asset URLs carry `?v=__ASSET_VERSION__`.** The deploy replaces the token, the
same way it stamps `sw.js`. Hand-numbered versions are how a change ships and
nobody is served it — that happened for seven deploys.

That stamp is also load-bearing for the service worker, which reads it as a
promise: a URL carrying `?v=` is treated as immutable and served from the cache
without asking the network. Give an asset a URL that can change under its own
name and `sw.js` will happily serve a stale one forever. Everything that must
stay current — the documents, `artworks.js`, `products.js` — is routed
network-first there by name, not by guesswork.

**Sources are minified at deploy, never in the repo.** The comments in these
files are the documentation, and they are stripped on the way out rather than
left out of the writing — see the minify step in `pages.yml`, which runs last
because every step before it reads these files as sources.

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

`wall` is optional, and only present on a work at all once it has one — see
`tools/gallery-mockup.py`. `x`/`y`/`w`/`h` are the painting's own pixel rect
within that mockup file (the tool prints them), which is what lets the work
panel's VIEW ON WALL button land the artwork exactly on the wall at any
screen size:

```js
wall: { enabled: true, image: "wall/work-18.jpg", x: 930, y: 440, w: 139, h: 139 }
```

Items for sale are separate — see `products.js` and `shop/README.md`. The
catalogue is the whole archive; the store is only what is for sale.
