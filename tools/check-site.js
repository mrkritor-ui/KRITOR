#!/usr/bin/env node
/* KRITOR — a last look at the built site before it is published.

   The workflow stamps versions, generates a page per work and per product,
   minifies, and then hands the whole tree to GitHub Pages, which serves it to
   the public as it stands. Nothing between the build and the visitor reads
   what was built. This does, and it fails the run — so nothing is published —
   when something a visitor or a search engine would hit is broken:

     • a placeholder that was meant to be filled and was not
     • an internal link, script, stylesheet or image that points at nothing
     • a page with no title, description or heading to say what it is
     • structured data that does not parse
     • a sitemap entry with no page behind it

   Usage: node tools/check-site.js [siteDir]   (default: the current folder)
   Run it on the finished tree, before the project's own files are removed. */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || '.');
const SITE = 'https://kritor.au';
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'backend', 'tools', 'scripts']);

const problems = [];
const fail = (where, what) => problems.push(`${where}: ${what}`);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const rel = file => path.relative(ROOT, file).split(path.sep).join('/');

/* Where a URL path on this site lands on disk, or null if nothing serves it.
   GitHub Pages serves /x/ from x/index.html and /x from x.html or x/index.html. */
function resolveUrlPath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  const base = path.join(ROOT, decoded);
  if (!base.startsWith(ROOT)) return null;
  const candidates = decoded.endsWith('/')
    ? [path.join(base, 'index.html')]
    : [base, base + '.html', path.join(base, 'index.html')];
  return candidates.find(c => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

const files = walk(ROOT);
const pages = files.filter(f => f.endsWith('.html'));
if (!pages.length) fail(rel(ROOT) || '.', 'no HTML pages found — is this the built site?');

/* Pages that are allowed to carry no description: they are not for search
   results — the error page, the checkout (robots.txt keeps crawlers out of
   it), and the old /about.html-style addresses that only send a visitor on to
   the real page. Anything else must say what it is. */
const isRedirectStub = html => /http-equiv=["']refresh["']/i.test(html);
const isPrivatePage = (file, html) =>
  /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html) ||
  ['404.html', 'checkout/index.html'].includes(rel(file)) ||
  isRedirectStub(html);

for (const file of pages) {
  const name = rel(file);
  const html = fs.readFileSync(file, 'utf8');

  // Placeholders the build is supposed to have filled.
  for (const token of ['__ASSET_VERSION__', '__BUILD_VERSION__', '<!--NOSCRIPT-->']) {
    if (html.includes(token)) fail(name, `still contains ${token}`);
  }

  // The page says what it is.
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  if (!title || !title.trim()) fail(name, 'no <title>');
  if (!/<html[^>]+lang=/i.test(html)) fail(name, '<html> has no lang');
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) fail(name, 'no viewport meta');
  if (!isRedirectStub(html) && !/<h1[\s>]/i.test(html)) fail(name, 'no <h1>');

  if (!isPrivatePage(file, html)) {
    const description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1];
    if (!description || !description.trim()) fail(name, 'no meta description');
    const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i) || [])[1];
    if (!canonical) fail(name, 'no canonical link');
    else if (!canonical.startsWith(SITE + '/')) fail(name, `canonical is not on ${SITE}: ${canonical}`);
    else if (!resolveUrlPath(canonical.slice(SITE.length))) fail(name, `canonical points at a page that does not exist: ${canonical}`);
  }

  // Structured data parses.
  const ld = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  ld.forEach((m, i) => {
    try { JSON.parse(m[1]); } catch (err) { fail(name, `JSON-LD block ${i + 1} does not parse (${err.message})`); }
  });

  // Every local reference lands on a file.
  const refs = [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)].map(m => m[1]);
  const preloads = [...html.matchAll(/\bimagesrcset=["']([^"']+)["']/gi)].map(m => m[1].split(',')[0].trim().split(/\s+/)[0]);
  for (const ref of [...refs, ...preloads]) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(ref)) continue;   // external, mailto:, anchors
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    const urlPath = clean.startsWith('/') ? clean : '/' + path.posix.join(path.posix.dirname('/' + name), clean);
    if (!resolveUrlPath(urlPath)) fail(name, `points at ${ref}, which does not exist`);
  }
}

// The service worker and manifest carry the same placeholders and references.
for (const f of ['sw.js']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes('__BUILD_VERSION__')) fail(f, 'still contains __BUILD_VERSION__');
}
const manifestPath = path.join(ROOT, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const icon of manifest.icons || []) {
      if (!resolveUrlPath(icon.src)) fail('manifest.json', `icon ${icon.src} does not exist`);
    }
    if (manifest.start_url && !resolveUrlPath(manifest.start_url.split('?')[0])) fail('manifest.json', `start_url ${manifest.start_url} does not exist`);
  } catch (err) { fail('manifest.json', `does not parse (${err.message})`); }
}

// The sitemap names only pages that exist, once each.
const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) {
  fail('sitemap.xml', 'missing');
} else {
  const locs = [...fs.readFileSync(sitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  if (!locs.length) fail('sitemap.xml', 'lists no pages');
  const seen = new Set();
  for (const loc of locs) {
    if (!loc.startsWith(SITE + '/')) { fail('sitemap.xml', `${loc} is not on ${SITE}`); continue; }
    if (seen.has(loc)) fail('sitemap.xml', `${loc} is listed twice`);
    seen.add(loc);
    if (!resolveUrlPath(loc.slice(SITE.length))) fail('sitemap.xml', `${loc} has no page`);
  }
}
const robotsPath = path.join(ROOT, 'robots.txt');
if (fs.existsSync(robotsPath) && !/Sitemap:\s*https:\/\/kritor\.au\/sitemap\.xml/i.test(fs.readFileSync(robotsPath, 'utf8'))) {
  fail('robots.txt', 'does not point at the sitemap');
}

// The generated product list parses and every item has what the store needs.
const productsPath = path.join(ROOT, 'products.json');
if (fs.existsSync(productsPath)) {
  try {
    const list = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
    const items = Array.isArray(list) ? list : (list.items || list.products || []);
    for (const item of items) {
      if (!item.id) fail('products.json', 'an item has no id');
      else if (!resolveUrlPath(`/shop/${item.id}/`)) fail('products.json', `${item.id} has no page under /shop/`);
    }
  } catch (err) { fail('products.json', `does not parse (${err.message})`); }
}

if (problems.length) {
  console.error(`check-site: ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${pages.length} pages\n`);
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log(`check-site: ${pages.length} pages, no problems`);
