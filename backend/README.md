# KRITOR payments worker

The store front-end is static and lives on GitHub Pages. Stripe will not let a
static page create a charge — an order's amount has to be decided somewhere the
customer can't edit, using a secret key that can never ship in the repo. That is
all this worker does.

It is small on purpose: two routes, no database, no framework.

```
browser                      this worker                    Stripe
  |  [{id, qty}], country        |                             |
  |----------------------------->|                             |
  |                              |  reads products.json        |
  |                              |  prices the order           |
  |                              |  + shipping                 |
  |                              |---- create PaymentIntent -->|
  |<----- clientSecret ----------|                             |
  |                                                            |
  |------- confirms card / Apple Pay directly with Stripe ---->|
```

The browser never sends a price. Editing the bag in devtools changes what is
displayed and nothing else.

---

## Setup

### 1. Deploy the worker

```bash
cd backend
npx wrangler login
npx wrangler secret put STRIPE_SECRET_KEY     # paste sk_test_... to start
npx wrangler deploy
```

Wrangler prints the deployed URL, e.g.
`https://kritor-payments.<your-subdomain>.workers.dev`.

`wrangler.toml` is set for `https://kritor.au`. Edit it first if your site is
served from anywhere else — both `SITE_ORIGIN` and `ALLOWED_ORIGINS` must match
your real origin, or the browser will be blocked by CORS and the worker won't
find the catalogue.

### 2. Point the store at it

In `store-config.js` at the repo root:

```js
window.KRITOR_STORE_CONFIG = {
  stripePublishableKey: "pk_test_...",
  paymentApiBase: "https://kritor-payments.<your-subdomain>.workers.dev",
  ...
};
```

Until both are filled in, `/checkout/` shows a configuration notice instead of a
payment form — a half-configured store can't take a real order.

### 3. Turn on Apple Pay

Apple Pay needs the domain verified before the button appears. It will not show
up on an unverified domain, and it fails silently rather than with an error.

1. Stripe Dashboard → **Settings → Payments → Payment methods → Apple Pay**
2. **Add a new domain**, enter the store's domain (no `https://`)
3. Download the association file Stripe gives you
4. Save it in this repo at
   `.well-known/apple-developer-merchantid-domain-association` — **no file
   extension**
5. Commit and push, then click **Verify** in Stripe

`.nojekyll` is committed at the repo root so GitHub Pages serves the
`.well-known` directory — Jekyll hides dot-directories otherwise, and
verification fails with a confusing 404. Don't delete it.

Test on a real iPhone in Safari with a card in Wallet. The simulator and desktop
Chrome will not show the button.

### 4. Go live

1. Swap `sk_test_` → `sk_live_` (`npx wrangler secret put STRIPE_SECRET_KEY`)
2. Swap `pk_test_` → `pk_live_` in `store-config.js`
3. Re-verify the domain under the live-mode Apple Pay settings — test and live
   mode keep separate domain lists

---

## Shipping

Two tables, deliberately:

| File | Role |
|---|---|
| `store-config.js` | what the customer *sees* while filling the form |
| `worker.js` → `SHIPPING` | what is actually *charged* |

Keep them in step. If they drift, the worker wins and the customer sees the
worker's figure on the pay button before confirming.

## products.json

The worker reads `products.json` from the live site rather than keeping its own
copy, so `products.js` stays the single source of truth. The Pages deploy
regenerates `products.json` from `products.js` on every push, and the worker
caches it for 60 seconds.

A price change is therefore live about a minute after the Pages deploy finishes.

## Testing

Use Stripe's test cards with any future expiry and any CVC:

| Card | Behaviour |
|---|---|
| `4242 4242 4242 4242` | succeeds |
| `4000 0025 0000 3155` | requires 3-D Secure |
| `4000 0000 0000 9995` | declined, insufficient funds |

Watch the worker while testing:

```bash
npx wrangler tail
```

## If you'd rather not use Cloudflare

`worker.js` is plain fetch-handler JavaScript with no Cloudflare-specific APIs
beyond the optional `cf` cache hint. It ports to Vercel, Netlify, Deno Deploy or
a small Node server with only the export signature changed. Whatever hosts it
needs to hold `STRIPE_SECRET_KEY` as an environment secret and send the CORS
headers.
