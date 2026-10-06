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
    `<meta property="og:image" content="${esc(imageUrl)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(imageUrl)}">`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join('\n');

  const page = productTemplate
    .replace('<title>KRITOR</title>', `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace('<link rel="canonical" href="https://kritor.au/store/">', `<link rel="canonical" href="${esc(canonicalUrl)}">`)
    .replace('<!--SEO-HEAD-->', head);

  fs.writeFileSync(path.join(dir, 'index.html'), page);
}

// Work pages resolve their id from the path, so the same file serves
// every one of them.
const artworksSrc = fs.readFileSync('artworks.js', 'utf8');
const artworks = JSON.parse(
  artworksSrc.slice(artworksSrc.indexOf('['), artworksSrc.lastIndexOf(']') + 1)
);
const workTemplate = fs.readFileSync('work.html', 'utf8');
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
for (const work of artworks) {
  if (!/^work-[A-Za-z0-9_-]+$/.test(work.id)) {
    throw new Error(`Invalid artwork id: ${JSON.stringify(work.id)}`);
  }
  fs.mkdirSync(work.id, { recursive: true });

  const num = (String(work.id).match(/(\d+)/) || [])[1] || work.id;
  const name = (work.title || '').trim();
  const label = !name || name === 'Untitled'
    ? `Untitled — Work ${num}`
    : (titleCounts.get(name) > 1 ? `${name} — Work ${num}` : name);
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
    `<meta property="og:image" content="${esc(imageUrl)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(imageUrl)}">`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join('\n');

  const page = workTemplate
    .replace('<title>KRITOR</title>', `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace('<link rel="canonical" href="https://kritor.au/art/">', `<link rel="canonical" href="${esc(canonicalUrl)}">`)
    .replace('<!--SEO-HEAD-->', head);

  fs.writeFileSync(path.join(work.id, 'index.html'), page);
}

// sitemap.xml — every static route plus every generated work and
// (listed, in-stock-or-not) shop route. robots.txt (checked into the
// repo root) points crawlers at this file.
// /architecture/ joins this list, and loses its noindex, when it has work in it.
const staticRoutes = ['/', '/about/', '/art/', '/store/'];
const workRoutes = artworks.map(w => `/${encodeURIComponent(w.id)}/`);
const shopRoutes = SHOP_ITEMS.filter(i => !i.unlisted).map(i => `/shop/${encodeURIComponent(i.id)}/`);
const urls = [...staticRoutes, ...workRoutes, ...shopRoutes];
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u => `  <url><loc>${esc(SITE + u)}</loc></url>`).join('\n') +
  '\n</urlset>\n';
fs.writeFileSync('sitemap.xml', sitemap);

console.log(`Built ${SHOP_ITEMS.length} store routes, ${artworks.length} work routes, and a ${urls.length}-url sitemap`);
