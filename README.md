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
pip install Pillow numpy
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

Deep links (`/work-01/`, `/shop/<id>/`) need their directories, which the deploy
also writes:

```sh
node tools/build-routes.js          # run from anywhere; it works on the repo root
```

That one build step writes each work's and shop item's own page, bakes its
`<title>`, description, canonical link, Open Graph/Twitter tags and JSON-LD
directly into it, and writes `sitemap.xml` and `products.json` from the same
data. A fresh clone's `/work-01/` and `/shop/<id>/` do not exist until it has
run, and the generated files are git-ignored.

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
about/ contact/ privacy/ shipping/ 404.html   the plain pages — one look, in
                    pages.css: monospace capitals, black and white, no boxes

terminal-shell.js   the chrome every terminal page shares: theme, bar, boot
                    sequence, typing, screensaver
terminal.js         the catalogue: views, filters, the work panel
terminal-store.js   the store: tiles, the bag, add to bag
terminal.css        the whole visual system
cursor.css          the drawn cursor, shared by every page including checkout

cart.js             cart state, in localStorage. No UI of its own — the
                    store's bag and the checkout's summary both paint
                    from it (the Stripe plumbing is checkout.js)
analytics.js        the Google tag (GA4) — see below
tools/build-og.py   the social share cards — see below
```

### Share cards

A shared link is shown as a picture, so every page names one: `og/<work id>.jpg`
for each catalogue work, `og/<product id>.jpg` for each shop item and
`og/default.jpg` for the front door, the rooms, About, Contact and Privacy. They
are 1200×630 (what every platform asks for), drawn by `tools/build-og.py` at
deploy time from the paintings themselves — the work trimmed to its own edges,
set whole in a 2px frame beside its title in the site face — and never committed,
so a card cannot outlive the painting or title it shows. `tools/build-routes.js`
writes each page's tags (including `og:image:alt`), and `tools/check-site.js`
fails the deploy if a card is missing, the wrong size, or over 600 KB.

To change which two paintings the site card shows, edit `DEFAULT_WORKS` at the top
of `build-og.py`. Run it locally after `build-routes.js` (it reads
`products.json`). The face it draws with is `tools/pix-chicago.ttf` — the same
outlines as `fonts/pix-chicago.woff2`, because Pillow cannot read WOFF2.

### Analytics

The Google tag lives in `analytics.js` and nowhere else; the measurement ID is
the one `ID` constant at the top of it. Every public page loads the file with a
single `<script … defer>` line (`/`, `/art/`, `/architecture/`, `/store/`,
`/about/`, `/contact/`, `/privacy/`, `/shipping/`, and the `work.html` / `product.html` templates every `/work-xx/` and
`/shop/<id>/` is built from) — a new page gets the tag by adding that one line.

It is skipped on `localhost` so local testing never reaches the reports, and it
is deliberately **not** on `/checkout/`: that page's Content-Security-Policy
names Stripe and nothing else as a script source, and letting Google in there is
a decision to make on purpose rather than a side effect. Opening a work pushes
`/work-xx/` onto the history, which GA4's enhanced measurement already reports
as a page view, so nothing needs to call `gtag()` for that.

### Security: the Content-Security-Policy

Every public page carries the same policy in a `<meta http-equiv>` tag (GitHub
Pages cannot send headers), and the checkout carries its own, stricter one:

```
default-src 'self';
script-src  'self' https://*.googletagmanager.com;
style-src   'self';
img-src     'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com;
font-src    'self';
connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com;
manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
```

Scripts come from this origin and the Google tag, and nothing is written into
the HTML: no inline `<script>`, no inline `<style>`, no `style="…"` attribute, no
`onclick=`, no `eval`. That is why the service-worker registration, the old
`?id=` link folding and the architecture room's start-up values are the small
files `sw-register.js`, `legacy-id.js` and `architecture-boot.js`, and why the
no-JavaScript rules live in `nojs.css`. Setting `element.style.x = …` from a
script is fine; writing markup with a `style` attribute is not. The two old
redirect pages (`/about.html`, `/store.html`) keep one inline script each,
allowed by its hash.

`tools/check-site.js` reads every built page against its own policy before
anything is published, and fails the deploy on an inline script, a source the
policy does not allow, a missing policy, or a policy that lets script in.

What a meta policy cannot do: `frame-ancestors` and reporting are ignored in a
`<meta>`, so this stops injected script and data theft but is not
clickjacking protection and cannot tell you when it blocks something. To use a
new service, add its host to the right directive in every page (the checker will
list the ones you miss) rather than loosening anything. The Google hosts are the
ones Google's own guidance lists for the Google tag with Analytics 4; they could
not be exercised against the live tag from the build sandbox, so after changing
them look in the browser console and in Analytics' real-time report.

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
Bastarda 9 (VT323 on the shopfront). All three are served from `fonts/` —
nothing on the site is fetched from a font host — and the README there says
where each came from and what it covers. Anything
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
