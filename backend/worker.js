/* KRITOR STORE — payment worker (Cloudflare Workers).

   The store is a static site, so this is the only place that can hold the
   Stripe secret key and the only place allowed to decide what an order costs.

   It never trusts the browser with money. The page posts [{id, qty}]; this
   worker looks each id up in products.json served from the site itself, prices
   the order, adds shipping for the destination, and creates the PaymentIntent.
   A bag edited in devtools changes nothing.

   Routes
     POST /create-payment-intent   {items, country}                -> {clientSecret, amount, currency}
     POST /update-payment-intent   {clientSecret, items, country}   -> {amount, currency}

   Environment (wrangler secret put / dashboard):
     STRIPE_SECRET_KEY   sk_test_... or sk_live_...
     SITE_ORIGIN         https://kritor.example  — where products.json lives
     ALLOWED_ORIGINS     comma-separated origins allowed to call this worker
*/

const CATALOGUE_TTL_MS = 60_000;

/* Shipping in cents by destination. Mirrors store-config.js, but THIS table is
   the one that decides what is charged. */
const SHIPPING = {
  AU: 3500,
  NZ: 6500,
  default: 9500
};

let catalogueCache = {at: 0, items: null};

async function loadCatalogue(env) {
  const now = Date.now();
  if (catalogueCache.items && now - catalogueCache.at < CATALOGUE_TTL_MS) {
    return catalogueCache.items;
  }

  const origin = String(env.SITE_ORIGIN || "").replace(/\/+$/, "");
  if (!origin) throw new Error("SITE_ORIGIN is not configured");

  const response = await fetch(`${origin}/products.json`, {
    cf: {cacheTtl: 60, cacheEverything: true}
  });
  if (!response.ok) throw new Error(`Could not load catalogue (${response.status})`);

  const items = await response.json();
  if (!Array.isArray(items)) throw new Error("Catalogue is malformed");

  catalogueCache = {at: now, items};
  return items;
}

function corsHeaders(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  const ok = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : (allowed[0] || ""),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {"Content-Type": "application/json", ...headers}
  });
}

/* Price the order from the server's own catalogue. Throws on anything the
   browser got wrong — unknown id, non-positive quantity, more than the stock,
   or a bag mixing currencies. */
function priceOrder(items, catalogue, country) {
  if (!Array.isArray(items) || !items.length) throw new Error("Your bag is empty.");
  if (items.length > 50) throw new Error("Too many lines in one order.");

  const byId = new Map(catalogue.map(i => [i.id, i]));
  let amount = 0;
  let currency = null;
  const detail = [];

  for (const line of items) {
    const item = byId.get(String(line && line.id));
    if (!item) throw new Error("An item in your bag is no longer available.");

    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty < 1) throw new Error("Invalid quantity.");

    const stock = Number.isFinite(item.stock) ? item.stock : 1;
    if (stock < 1) throw new Error(`${item.title} is sold out.`);
    if (qty > stock) throw new Error(`Only ${stock} of ${item.title} available.`);

    const itemCurrency = String(item.currency || "AUD").toLowerCase();
    if (currency && itemCurrency !== currency) {
      throw new Error("All items in one order must share a currency.");
    }
    currency = itemCurrency;

    amount += item.price * qty;
    detail.push(`${item.title} x${qty}`);
  }

  const shipping = Number.isFinite(SHIPPING[country]) ? SHIPPING[country] : SHIPPING.default;
  amount += shipping;

  if (!Number.isFinite(amount) || amount < 100) throw new Error("Order total is invalid.");

  return {amount, currency: currency || "aud", shipping, summary: detail.join(", ")};
}

async function stripeRequest(env, path, form) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(form)
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error((payload.error && payload.error.message) || "Payment provider error.");
  }
  return payload;
}

async function createPaymentIntent(request, env, cors) {
  const {items, country} = await request.json();
  const catalogue = await loadCatalogue(env);
  const {amount, currency, shipping, summary} = priceOrder(items, catalogue, country);

  const intent = await stripeRequest(env, "payment_intents", {
    amount: String(amount),
    currency,
    "automatic_payment_methods[enabled]": "true",
    description: `KRITOR — ${summary}`,
    "metadata[items]": JSON.stringify(items).slice(0, 480),
    "metadata[shipping_cents]": String(shipping)
  });

  return json({
    clientSecret: intent.client_secret,
    amount,
    currency: currency.toUpperCase()
  }, 200, cors);
}

/* The customer changed shipping country after the intent was made. Re-price
   and update the existing intent rather than creating a second one. */
async function updatePaymentIntent(request, env, cors) {
  const {clientSecret, items, country} = await request.json();

  const id = String(clientSecret || "").split("_secret_")[0];
  if (!/^pi_[A-Za-z0-9]+$/.test(id)) return json({error: "Invalid payment reference."}, 400, cors);

  const catalogue = await loadCatalogue(env);
  const {amount, currency, shipping} = priceOrder(items, catalogue, country);

  /* Confirm the secret really belongs to this intent before touching it. */
  const existing = await stripeRequest(env, `payment_intents/${id}`, {});
  if (existing.client_secret !== clientSecret) {
    return json({error: "Invalid payment reference."}, 403, cors);
  }
  if (existing.status !== "requires_payment_method" && existing.status !== "requires_confirmation") {
    return json({error: "This payment can no longer be changed."}, 409, cors);
  }

  await stripeRequest(env, `payment_intents/${id}`, {
    amount: String(amount),
    "metadata[shipping_cents]": String(shipping)
  });

  return json({amount, currency: currency.toUpperCase()}, 200, cors);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: cors});
    if (request.method !== "POST") return json({error: "Method not allowed."}, 405, cors);

    if (!env.STRIPE_SECRET_KEY) return json({error: "Payments are not configured."}, 500, cors);

    const {pathname} = new URL(request.url);

    try {
      if (pathname.endsWith("/create-payment-intent")) return await createPaymentIntent(request, env, cors);
      if (pathname.endsWith("/update-payment-intent")) return await updatePaymentIntent(request, env, cors);
      return json({error: "Not found."}, 404, cors);
    } catch (error) {
      /* Pricing and validation messages are safe to show; anything else is
         logged and generalised so internals never reach the browser. */
      const message = error && error.message ? error.message : "Checkout failed.";
      console.error("checkout error:", message);
      return json({error: message}, 400, cors);
    }
  }
};
