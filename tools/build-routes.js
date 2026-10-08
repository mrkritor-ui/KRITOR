#!/usr/bin/env node
/* KRITOR — the generated routes.

   Writes, into the working tree, every page that is not checked in:

     /work-xx/index.html    one per catalogue work, from work.html
     /shop/<id>/index.html  one per shop item, from product.html
     products.json          the price list the payment worker reads
     sitemap.xml            every public route

   Each generated page has its own <title>, description, canonical, Open Graph
   and Twitter tags and JSON-LD baked in, so a crawler or link-preview bot that
   never runs JavaScript sees the right thing for that page.

   This used to be a heredoc inside .github/workflows/pages.yml. It is a file
   so it can be linted, run on its own and read without counting ten spaces of
   YAML indentation:

       node tools/build-routes.js

   Run from anywhere; it works on the repository root. The deploy runs it after
   the version stamp and before the image build. It fails loudly (a thrown
   error, a non-zero exit) rather than writing a half-built site. */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const { SHOP_ITEMS } = require(path.join(ROOT, 'products.js'));

if (!Array.isArray(SHOP_ITEMS)) {
  throw new Error('products.js did not export SHOP_ITEMS');
}

const SITE = 'https://kritor.au';

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Defends the </script> boundary of an inlined JSON-LD block against
// any field value that happens to contain it — none do today, but a
// title or description is free text an artist can edit.
function ldJson(data) {
  return JSON.stringify(data).replace(/<\//g, '<\\/');
}

// What a visitor without JavaScript — and any crawler or link-preview bot that
// does not run it — gets in place of the machine. Every page here draws itself
// with script, so without it a page is a "LOADING" bar and nothing else. This
// is the plain version: a list of what is there, with the way on. It sits in
// <noscript>, so a browser that runs script never shows it. The pages carry a
// <!--NOSCRIPT--> placeholder where it goes, and the build refuses to run
// without one rather than ship a page that is quietly blank.
const NOJS_LINKS = [['/', 'Home'], ['/art/', 'Art'], ['/store/', 'Store'], ['/about/', 'About'], ['/contact/', 'Contact'], ['/privacy/', 'Privacy'], ['/shipping/', 'Shipping and returns']];
const NOJS_NAV = NOJS_LINKS.map(([href, label]) => `<a href="${href}">${label}</a>`).join(' · ');

function nojs(inner) {
  return `<noscript><div class="nojs">\n${inner}\n<p class="nojs-nav">${NOJS_NAV}</p>\n</div></noscript>`;
}

function requireToken(file, html) {
  if (html.split('<!--NOSCRIPT-->').length !== 2) {
    throw new Error(`${file} must contain exactly one <!--NOSCRIPT--> placeholder`);
  }
}

// The checked-in pages are filled in place, as the version stamp already is, so
// on a deploy's throwaway checkout that is all there is to it. Run locally it
// edits tracked files — `git checkout -- .` puts them back — and a second run
// finds them already filled and leaves them alone rather than failing.
function fillNoscript(file, inner) {
  const html = fs.readFileSync(file, 'utf8');
  if (html.includes('<div class="nojs">')) {
    console.log(`${file}: already filled`);
    return;
  }
  requireToken(file, html);
  fs.writeFileSync(file, html.replace('<!--NOSCRIPT-->', () => nojs(inner)));
}

const assetUrl = p => encodeURI('/' + String(p).replace(/^\//, ''));

// The picture a link to a page is shown with: og/<id>.jpg, drawn from the
// painting itself by tools/build-og.py (which writes one for every work and
// shop item that has an image, and og/default.jpg for the site). A page with
// no painting gets the site's own. The JSON-LD below keeps pointing at the
// painting — that is what a search engine wants to index — while this is what
// a person sees in a feed.
function shareCard(id, hasImage, alt) {
  const url = `${SITE}/og/${hasImage ? encodeURIComponent(id) : 'default'}.jpg`;
  return {
    og: [
      `<meta property="og:image" content="${esc(url)}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      `<meta property="og:image:alt" content="${esc(alt)}">`,
    ],
    twitter: [
      `<meta name="twitter:image" content="${esc(url)}">`,
      `<meta name="twitter:image:alt" content="${esc(alt)}">`,
    ],
  };
}

const seen = new Set();
for (const item of SHOP_ITEMS) {
  if (!item.id || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) {
    throw new Error(`Invalid shop item id: ${JSON.stringify(item.id)}`);
  }
  if (seen.has(item.id)) throw new Error(`Duplicate shop item id: ${item.id}`);
  seen.add(item.id);
  if (!Number.isInteger(item.price) || item.price < 0) {
    throw new Error(`${item.id}: price must be an integer in cents`);
  }
  if (!item.currency) throw new Error(`${item.id}: currency is required`);
}

fs.writeFileSync('products.json', JSON.stringify(SHOP_ITEMS));

// Every generated route gets its own <title>, description, canonical,
// Open Graph / Twitter Card tags and JSON-LD baked directly into the
// HTML at build time — so a crawler that never runs JS (link-preview
// bots included) still sees correct per-item metadata, not the
// generic template every one of these pages started from.
const productTemplate = fs.readFileSync('product.html', 'utf8');
requireToken('product.html', productTemplate);
for (const item of SHOP_ITEMS) {
  const dir = path.join('shop', item.id);
  fs.mkdirSync(dir, { recursive: true });

  const title = `${item.title || 'KRITOR'} — KRITOR Store`;
  const bits = [item.edition, item.materials, item.size].filter(Boolean);
  const priceText = `${item.currency} ${((item.price || 0) / 100).toFixed(2)}`;
  const desc = `${item.title || 'Original work'}${bits.length ? ', ' + bits.join(', ') : ''} — ${priceText}. An original work by KRITOR, shipped from Melbourne.`;
  const canonicalUrl = `${SITE}/shop/${encodeURIComponent(item.id)}/`;
  const imagePath = (item.images || [])[0];
  const imageUrl = imagePath
    ? `${SITE}${encodeURI(imagePath.startsWith('/') ? imagePath : '/' + imagePath)}`
    : `${SITE}/icon.png`;
  const soldOut = !Number.isFinite(item.stock) ? false : item.stock < 1;
  const card = shareCard(item.id, Boolean(imagePath), `${item.title || 'Original work'}, an original work by KRITOR`);

  const plain = [
    `<h1>${esc(item.title || 'Original work')}</h1>`,
    imagePath ? `<p><img src="${esc(assetUrl(imagePath))}" alt="${esc(item.title || 'Original work')}"></p>` : '',
    bits.length ? `<p>${esc(bits.join(' · '))}</p>` : '',
    `<p>${esc(priceText)} — ${soldOut ? 'sold out' : 'available'}</p>`,
    item.shipping ? `<p>${esc(item.shipping)}</p>` : '',
    item.description ? `<p>${esc(item.description)}</p>` : '',
    '<p>Ordering on this site needs JavaScript.</p>',
  ].filter(Boolean).join('\n');

  const jsonLd = ldJson({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.title || 'Original work',
    image: imageUrl,
    description: desc,
    sku: item.id,
    url: canonicalUrl,
    brand: { '@type': 'Brand', name: 'KRITOR' },
    offers: {
      '@type': 'Offer',
      url: canonicalUrl,
      priceCurrency: item.currency,
      price: ((item.price || 0) / 100).toFixed(2),
      availability: soldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  });

  const head = [
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="KRITOR">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(canonicalUrl)}">`,
    ...card.og,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    ...card.twitter,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join('\n');

  const page = productTemplate
    .replace('<title>KRITOR</title>', `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace('<link rel="canonical" href="https://kritor.au/store/">', `<link rel="canonical" href="${esc(canonicalUrl)}">`)
    .replace('<!--SEO-HEAD-->', head)
    .replace('<h1>Store</h1>', () => `<h1>${esc(item.title || 'Original work')}</h1>`)
    .replace('<!--NOSCRIPT-->', () => nojs(plain));

  fs.writeFileSync(path.join(dir, 'index.html'), page);
}

// Work pages resolve their id from the path, so the same file serves
// every one of them.
const artworksSrc = fs.readFileSync('artworks.js', 'utf8');
const artworks = JSON.parse(
  artworksSrc.slice(artworksSrc.indexOf('['), artworksSrc.lastIndexOf(']') + 1)
);
const workTemplate = fs.readFileSync('work.html', 'utf8');
requireToken('work.html', workTemplate);
// The same naming rule terminal.js uses for the tab title and the
// accessible names (workLabel there): untitled works carry their
// number, and so do works that share a name — two pages with the same
// title, description and structured data cannot be told apart by a
// search engine, a bookmark or a link preview.
const titleCounts = new Map();
for (const w of artworks) {
  const t = (w.title || '').trim();
  titleCounts.set(t, (titleCounts.get(t) || 0) + 1);
}
function labelFor(work) {
  const num = (String(work.id).match(/(\d+)/) || [])[1] || work.id;
  const name = (work.title || '').trim();
  if (!name || name === 'Untitled') return `Untitled — Work ${num}`;
  return titleCounts.get(name) > 1 ? `${name} — Work ${num}` : name;
}
function factsFor(work) {
  return [
    work.year && String(work.year),
    work.collection,
    work.materials,
    work.size && !/^—/.test(work.size) ? work.size : '',
  ].filter(Boolean);
}
for (const work of artworks) {
  if (!/^work-[A-Za-z0-9_-]+$/.test(work.id)) {
    throw new Error(`Invalid artwork id: ${JSON.stringify(work.id)}`);
  }
  fs.mkdirSync(work.id, { recursive: true });

  const label = labelFor(work);
  const bits = [];
  if (work.year) bits.push(work.year);
  if (work.materials) bits.push(work.materials);
  if (work.size && !/^—/.test(work.size)) bits.push(work.size);
  const desc = `${label}${bits.length ? ', ' + bits.join(', ') : ''} — an original work by KRITOR.`;
  const title = `${label} — KRITOR Art`;
  const canonicalUrl = `${SITE}/${encodeURIComponent(work.id)}/`;
  const imagePath = work.image;
  const imageUrl = imagePath
    ? `${SITE}${encodeURI(imagePath.startsWith('/') ? imagePath : '/' + imagePath)}`
    : `${SITE}/icon.png`;
  const card = shareCard(work.id, Boolean(imagePath), `${label}${work.year ? ', ' + work.year : ''}, a work by KRITOR`);

  const jsonLd = ldJson(Object.assign({
    '@context': 'https://schema.org',
    '@type': 'VisualArtwork',
    name: label,
    url: canonicalUrl,
    image: imageUrl,
    creator: { '@type': 'Person', name: 'KRITOR', url: `${SITE}/` },
    isPartOf: { '@type': 'CollectionPage', name: 'Art Catalogue — KRITOR', url: `${SITE}/art/` },
  }, work.year ? { dateCreated: String(work.year) } : {}, work.materials ? { artMedium: work.materials } : {}));

  const head = [
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="KRITOR">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(canonicalUrl)}">`,
    ...card.og,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    ...card.twitter,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join('\n');

  const plain = [
    `<h1>${esc(label)}</h1>`,
    imagePath ? `<p><img src="${esc(assetUrl(imagePath))}" alt="${esc(label)}${work.year ? ', ' + esc(work.year) : ''}"></p>` : '',
    factsFor(work).length ? `<p>${esc(factsFor(work).join(' · '))}</p>` : '',
    '<p><a href="/art/">All works</a></p>',
  ].filter(Boolean).join('\n');

  const page = workTemplate
    .replace('<title>KRITOR</title>', `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace('<link rel="canonical" href="https://kritor.au/art/">', `<link rel="canonical" href="${esc(canonicalUrl)}">`)
    .replace('<!--SEO-HEAD-->', head)
    .replace('<h1>Art Catalogue</h1>', () => `<h1>${esc(label)}</h1>`)
    .replace('<!--NOSCRIPT-->', () => nojs(plain));

  fs.writeFileSync(path.join(work.id, 'index.html'), page);
}

// The rooms that list things, from the same data the pages draw from.
fillNoscript('index.html', [
  '<h1>KRITOR</h1>',
  '<p>KRITOR is the practice name of Melbourne artist Kristian Torcasio: expressionist paintings and mixed media, an art catalogue, and a store for original work.</p>',
].join('\n'));

fillNoscript('art/index.html', [
  '<h1>KRITOR — Art Catalogue</h1>',
  `<p>${artworks.length} works. The catalogue draws itself with JavaScript; this is the plain list.</p>`,
  '<ul>' + artworks.map(w => {
    const facts = factsFor(w);
    return `<li><a href="/${esc(encodeURIComponent(w.id))}/">${esc(labelFor(w))}</a>${facts.length ? ' — ' + esc(facts.join(', ')) : ''}</li>`;
  }).join('\n') + '</ul>',
].join('\n'));

// The two templates are served themselves, at the old /work.html?id= and
// /product.html?id= addresses that script folds into the clean ones. Without
// script nothing folds them, so they say where the page went.
fillNoscript('work.html', [
  '<h1>KRITOR — Art Catalogue</h1>',
  '<p>This address has moved. <a href="/art/">Open the art catalogue.</a></p>',
].join('\n'));
fillNoscript('product.html', [
  '<h1>KRITOR — Store</h1>',
  '<p>This address has moved. <a href="/store/">Open the store.</a></p>',
].join('\n'));

fillNoscript('architecture/index.html', [
  '<h1>KRITOR — Architecture</h1>',
  '<p>Nothing published yet.</p>',
].join('\n'));

const listed = SHOP_ITEMS.filter(i => !i.unlisted);
fillNoscript('store/index.html', [
  '<h1>KRITOR — Store</h1>',
  '<p>Original work, shipped from Melbourne. Ordering on this site needs JavaScript.</p>',
  '<ul>' + listed.map(i => {
    const sold = Number.isFinite(i.stock) && i.stock < 1;
    const price = `${i.currency} ${((i.price || 0) / 100).toFixed(2)}`;
    return `<li><a href="/shop/${esc(encodeURIComponent(i.id))}/">${esc(i.title || 'Original work')}</a> — ${esc(price)}${sold ? ', sold out' : ''}</li>`;
  }).join('\n') + '</ul>',
].join('\n'));

// sitemap.xml — every static route plus every generated work and
// (listed, in-stock-or-not) shop route. robots.txt (checked into the
// repo root) points crawlers at this file.
// /architecture/ joins this list, and loses its noindex, when it has work in it.
const staticRoutes = ['/', '/about/', '/contact/', '/art/', '/store/', '/privacy/', '/shipping/'];
const workRoutes = artworks.map(w => `/${encodeURIComponent(w.id)}/`);
const shopRoutes = SHOP_ITEMS.filter(i => !i.unlisted).map(i => `/shop/${encodeURIComponent(i.id)}/`);
const urls = [...staticRoutes, ...workRoutes, ...shopRoutes];
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u => `  <url><loc>${esc(SITE + u)}</loc></url>`).join('\n') +
  '\n</urlset>\n';
fs.writeFileSync('sitemap.xml', sitemap);

console.log(`Built ${SHOP_ITEMS.length} store routes, ${artworks.length} work routes, and a ${urls.length}-url sitemap`);
