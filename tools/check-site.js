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
     • a share image a page names that is missing, or not the 1200x630 the
       tags say it is
     • a page that does not follow its own Content-Security-Policy (an inline
       script, a source the policy does not allow, no policy at all)

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
const isPrivatePageName = name => ['404.html', 'checkout/index.html'].includes(name);
const isPrivatePage = (file, html) =>
  /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html) ||
  isPrivatePageName(rel(file)) ||
  isRedirectStub(html);

// The width and height of a JPEG, read from its first start-of-frame marker.
function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buffer.length) {
    if (buffer[i] !== 0xff) { i++; continue; }
    const marker = buffer[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + buffer.readUInt16BE(i + 2);
  }
  return null;
}

/* The picture a page is shown with when its link is shared. The tags must
   point at a file that exists, and where a size is declared the file must be
   it — a card the wrong shape is cropped by every platform that shows it. */
function checkShareImage(name, html) {
  const looked = new Set();      // og:image and twitter:image are usually one file
  for (const prop of ['og:image', 'twitter:image']) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
    const url = (html.match(re) || [])[1];
    if (!url) { if (prop === 'og:image' && !isPrivatePageName(name)) fail(name, 'no og:image'); continue; }
    if (!url.startsWith(SITE + '/')) { fail(name, `${prop} is not on ${SITE}: ${url}`); continue; }
    const file = resolveUrlPath(url.slice(SITE.length));
    if (!file) { fail(name, `${prop} points at ${url}, which does not exist`); continue; }
    if (!/\.jpe?g$/i.test(file) || looked.has(file)) continue;
    looked.add(file);
    const buf = fs.readFileSync(file);
    const size = jpegSize(buf);
    if (!size) { fail(name, `${url} is not a readable JPEG`); continue; }
    const declared = {
      width: Number((html.match(/<meta[^>]+property=["']og:image:width["'][^>]+content=["'](\d+)["']/i) || [])[1]),
      height: Number((html.match(/<meta[^>]+property=["']og:image:height["'][^>]+content=["'](\d+)["']/i) || [])[1]),
    };
    if (prop === 'og:image' && (size.width !== declared.width || size.height !== declared.height)) {
      fail(name, `${url} is ${size.width}x${size.height}, but the page says ${declared.width}x${declared.height}`);
    }
    if (url.includes('/og/') && (size.width !== 1200 || size.height !== 630)) fail(name, `${url} is ${size.width}x${size.height}, not 1200x630`);
    if (buf.length > 600 * 1024) fail(name, `${url} is ${Math.round(buf.length / 1024)} KB — over the 600 KB a preview should stay under`);
  }
}

/* ── Content-Security-Policy ─────────────────────────────────────────────────
   GitHub Pages cannot send headers, so every page carries its policy in a
   <meta http-equiv> tag. A policy nobody re-reads decays: somebody adds an
   inline <script> for a quick fix, and the page either breaks in a browser or
   — worse — the policy is quietly loosened to let it through. So each page is
   read against its own policy here:

     • it has one, with no 'unsafe-inline' / 'unsafe-eval' for script
     • every <script> is either from a source the policy allows, or inline and
       named by its hash
     • no inline event handlers
     • every stylesheet, image and font it asks for is allowed, and inline
       style is only there if the policy says so (the checkout's Stripe fields
       need it; the public pages do not) */
const sha256 = text => 'sha256-' + require('crypto').createHash('sha256').update(text).digest('base64');

function parsePolicy(content) {
  const directives = {};
  for (const part of content.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives[name.toLowerCase()] = sources;
  }
  return directives;
}

const FALLBACK = { 'script-src': 'default-src', 'style-src': 'default-src', 'img-src': 'default-src', 'font-src': 'default-src', 'connect-src': 'default-src' };
const sourcesFor = (policy, directive) => policy[directive] || policy[FALLBACK[directive]] || null;

// Does a CSP source list allow this URL? `url` is a path (same site) or absolute.
function allows(sources, url) {
  if (!sources) return true;                       // no directive and no fallback: unrestricted
  if (sources.includes("'none'")) return false;
  let u;
  try { u = new URL(url, SITE + '/'); } catch { return false; }
  return sources.some(src => {
    if (src === "'self'") return u.origin === SITE;
    if (/^[a-z][a-z0-9+.-]*:$/i.test(src)) return u.protocol === src.toLowerCase();       // data: blob: https:
    if (src.startsWith("'")) return false;                                                 // nonce / hash / keywords
    const m = src.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:*]+)(?::(\d+|\*))?(\/.*)?$/i);
    if (!m) return false;
    if (m[1] && u.protocol !== m[1].toLowerCase() + ':') return false;
    const host = m[3].toLowerCase();
    return m[2] ? u.hostname.toLowerCase().endsWith('.' + host) : u.hostname.toLowerCase() === host;
  });
}

// What each page declared, so the copies can be compared once they have all been read.
const publicPolicies = new Map();

function checkCsp(name, source) {
  // Comments explain the policy in prose and mention <script> tags; they are not markup.
  const html = source.replace(/<!--[\s\S]*?-->/g, '');
  const tag = html.match(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i);
  // The value holds apostrophes ('self'), so it ends at the quote that opened it.
  const content = tag && (tag[0].match(/content=(["'])(.*?)\1/i) || [])[2];
  if (!content) { fail(name, 'no Content-Security-Policy <meta>'); return; }
  publicPolicies.set(name, content);
  const policy = parsePolicy(content);
  const scriptSources = sourcesFor(policy, 'script-src') || [];
  const styleSources = sourcesFor(policy, 'style-src') || [];

  if (scriptSources.includes("'unsafe-inline'") || scriptSources.includes("'unsafe-eval'") || scriptSources.includes('*')) {
    fail(name, "its policy lets script in through 'unsafe-inline', 'unsafe-eval' or '*'");
  }
  if (!(policy['object-src'] || policy['default-src'] || []).includes("'none'")) fail(name, "its policy does not close object-src (or default-src) with 'none'");
  if (!policy['base-uri']) fail(name, 'its policy has no base-uri');

  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/type=["'](?:application\/ld\+json|application\/json|importmap|speculationrules)["']/i.test(attrs)) continue;   // data, not run
    const src = (attrs.match(/\bsrc=["']([^"']+)["']/i) || [])[1];
    if (src) {
      if (!allows(scriptSources, src)) fail(name, `its policy does not allow the script ${src}`);
    } else if (m[2].trim() && !scriptSources.includes(`'${sha256(m[2])}'`)) {
      fail(name, 'has an inline <script> its policy does not name by hash — move it to a file');
    }
  }
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) fail(name, 'has an inline event handler (onclick=, …)');

  const inlineStyleOk = styleSources.includes("'unsafe-inline'");
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (m[1].trim() && !inlineStyleOk && !styleSources.includes(`'${sha256(m[1])}'`)) fail(name, 'has an inline <style> its policy does not allow — move it to a file');
  }
  if (!inlineStyleOk && /<[a-z][^>]*\sstyle\s*=/i.test(html)) fail(name, 'has a style="…" attribute its policy does not allow');

  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tagText = m[0];
    const href = (tagText.match(/\bhref=["']([^"']+)["']/i) || [])[1];
    const relAttr = ((tagText.match(/\brel=["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
    const as = ((tagText.match(/\bas=["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
    if (!href || /^(?:#|mailto:|tel:)/.test(href)) continue;
    const directive = relAttr.includes('stylesheet') || as === 'style' ? 'style-src'
      : as === 'font' ? 'font-src'
      : (as === 'image' || /icon/.test(relAttr)) ? 'img-src'
      : as === 'script' ? 'script-src' : null;
    if (directive && !allows(sourcesFor(policy, directive), href)) fail(name, `its policy does not allow ${href} (${directive})`);
  }
  for (const m of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    if (!allows(sourcesFor(policy, 'img-src'), m[1])) fail(name, `its policy does not allow the image ${m[1]}`);
  }
}

for (const file of pages) {
  const name = rel(file);
  const html = fs.readFileSync(file, 'utf8');

  // Placeholders the build is supposed to have filled.
  for (const token of ['__ASSET_VERSION__', '__BUILD_VERSION__', '<!--NOSCRIPT-->']) {
    if (html.includes(token)) fail(name, `still contains ${token}`);
  }

  checkCsp(name, html);
  // work.html and product.html are templates: the build copies them once per work
  // and item and fills the placeholder in each copy. The bare template, still
  // carrying it, is only the address old ?id= links arrive at.
  if (!isPrivatePage(file, html) && !html.includes('<!--SEO-HEAD-->')) checkShareImage(name, html);

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

/* The public pages share one policy, written out in each (a <meta> cannot
   include another file). The checkout has its own, and the two old redirect
   pages carry a hash policy for their one script. Everything else must match,
   so a host added to one page and forgotten on the rest is caught here. */
{
  const shared = [...publicPolicies].filter(([name, content]) => name !== 'checkout/index.html' && !/^default-src 'none'/.test(content));
  const counts = new Map();
  for (const [, content] of shared) counts.set(content, (counts.get(content) || 0) + 1);
  const [usual] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
  for (const [name, content] of shared) if (content !== usual) fail(name, 'its Content-Security-Policy differs from the one the other pages share');
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
