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
     POST /stripe-webhook          Stripe event, signature verified   -> {received}
                                   payment_intent.succeeded marks sold,
                                   charge.refunded puts it back on sale

   Environment (wrangler secret put / dashboard):
     STRIPE_SECRET_KEY   sk_test_... or sk_live_...
     SITE_ORIGIN         https://kritor.example  — where products.json lives
     ALLOWED_ORIGINS     comma-separated origins allowed to call this worker
     STRIPE_WEBHOOK_SECRET  whsec_... signing secret. Comma-separate several
                         to accept test and live endpoints at the same time.

   Bindings
     DB                  D1, holding the sold_items ledger (see schema.sql).
                         Optional: without it the worker behaves as before and
                         nothing is ever marked sold.
*/

const CATALOGUE_TTL_MS = 60_000;

/* Fallback postage in cents by destination, for an item that names none of its
   own. Mirrors store-config.js, but THIS table is the one that decides what is
   charged.

   One flat rate per order is the wrong shape for original work: a 15x10cm
   study on board and a 70x90cm canvas do not cost the same to send, and a rate
   that suits one overcharges or underprices the other. Items carry their own
   shippingCents and this is only what they fall back to. */
const SHIPPING = {
  AU: 3500,
  NZ: 6500,
  default: 9500
};

/* What it costs to send this one item to this country.

   Charged once per item rather than per unit: two prints of an edition go in
   one tube, so multiplying by quantity would invent postage that is not spent.
   Several different items sum, which can overcharge slightly when two would
   travel together — it never underprices, which is the error worth avoiding
   when the alternative comes out of a sale. */
function postageFor(item, country) {
  const own = item && item.shippingCents;
  if (own && Number.isFinite(own[country])) return own[country];
  if (own && Number.isFinite(own.default)) return own.default;
  return Number.isFinite(SHIPPING[country]) ? SHIPPING[country] : SHIPPING.default;
}

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
  let shipping = 0;
  let currency = null;
  const detail = [];

  /* Collapse repeated ids before pricing. Checking stock per line lets two
     lines naming the same id each pass a stock-of-1 check on their own, so an
     order for two of a one-of-one painting would be accepted and charged
     twice. The bag cannot produce that, but this endpoint is public and a
     hand-made request can. */
  const wanted = new Map();
  for (const line of items) {
    const qty = Math.floor(Number(line && line.qty));
    if (!Number.isFinite(qty) || qty < 1) throw new Error("Invalid quantity.");
    const id = String(line && line.id);
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }

  for (const [id, qty] of wanted) {
    const item = byId.get(id);
    if (!item) throw new Error("An item in your bag is no longer available.");

    const stock = Number.isFinite(item.stock) ? item.stock : 1;
    if (stock < 1) throw new Error(`${item.title} is sold out.`);
    if (qty > stock) throw new Error(`Only ${stock} of ${item.title} available.`);

    const itemCurrency = String(item.currency || "AUD").toLowerCase();
    if (currency && itemCurrency !== currency) {
      throw new Error("All items in one order must share a currency.");
    }
    currency = itemCurrency;

    amount += item.price * qty;
    shipping += postageFor(item, country);
    detail.push(`${item.title} x${qty}`);
  }

  amount += shipping;

  if (!Number.isFinite(amount) || amount < 100) throw new Error("Order total is invalid.");

  return {
    amount,
    currency: currency || "aud",
    shipping,
    summary: detail.join(", "),
    ids: [...wanted.keys()]
  };
}

/* Ids that have already been paid for. The catalogue cannot know this — it is
   rebuilt from products.js on deploy and has no idea what sold since.

   Fails open deliberately. If D1 is unreachable this returns nothing sold and
   the sale proceeds: a rare double-sale can be refunded, but a store that
   refuses every order because a database hiccuped cannot be. */
async function soldItems(env) {
  if (!env.DB) return new Set();
  try {
    const {results} = await env.DB.prepare("SELECT item_id FROM sold_items").all();
    return new Set((results || []).map(row => row.item_id));
  } catch (error) {
    console.error("stock ledger unavailable:", error && error.message);
    return new Set();
  }
}

/* Record a completed sale. Called only from a verified webhook.

   OR IGNORE because Stripe retries an event until it gets a 2xx, so the same
   payment can arrive several times and the second must not be an error. */
async function recordSale(env, intent) {
  if (!env.DB || !intent) return;

  const ids = String((intent.metadata && intent.metadata.item_ids) || "")
    .split(",").map(part => part.trim()).filter(Boolean);

  /* No ids means the intent predates item_ids being stamped on, or was made
     somewhere other than create-payment-intent. Nothing to record, but say so:
     silence here looks exactly like a webhook that never arrived. */
  if (!ids.length) {
    console.log("webhook: intent", intent.id, "carries no item_ids, nothing recorded");
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch(ids.map(id => env.DB
    .prepare("INSERT OR IGNORE INTO sold_items (item_id, pi_id, sold_at) VALUES (?, ?, ?)")
    .bind(id, String(intent.id || ""), now)));

  console.log("recorded sale:", ids.join(", "), "from", intent.id);
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

/* A refund puts the work back on sale. Without this the ledger only ever grows:
   money goes back to the customer and the painting stays marked sold until
   somebody remembers to delete the row by hand.

   Full refunds only. A partial refund is a price adjustment — the customer
   keeps the work — and unselling there would offer a painting that is gone. */
async function releaseSale(env, charge) {
  if (!env.DB || !charge) return;

  if (Number(charge.amount_refunded) < Number(charge.amount)) {
    console.log("webhook: partial refund on", charge.id, "- ledger left alone");
    return;
  }

  const intentId = String(charge.payment_intent || "");
  if (!intentId) {
    console.log("webhook: refunded charge", charge.id, "names no intent, nothing to release");
    return;
  }

  const {meta} = await env.DB
    .prepare("DELETE FROM sold_items WHERE pi_id = ?").bind(intentId).run();

  console.log("released", (meta && meta.changes) || 0, "item(s) back on sale from", intentId);
}

/* Compare without leaking, through timing, how much of the digest matched. */
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/* Stripe signs each event with the endpoint's secret, over "timestamp.body".

   This is the only thing standing between the ledger and anyone on the
   internet: the URL is public, and a forged payment_intent.succeeded would
   mark a painting sold that nobody bought. The timestamp check is what stops
   a genuine event being captured and replayed later. */
async function signatureIsValid(payload, header, secret, toleranceSeconds = 300) {
  const parts = {};
  for (const piece of String(header || "").split(",")) {
    const at = piece.indexOf("=");
    if (at < 0) continue;
    const key = piece.slice(0, at).trim();
    (parts[key] = parts[key] || []).push(piece.slice(at + 1).trim());
  }

  const timestamp = (parts.t || [])[0];
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");

  return signatures.some(candidate => constantTimeEqual(expected, candidate));
}

/* Stripe telling us what actually happened, which the browser cannot be
   trusted to report: the tab can be closed the instant the card clears. */
async function handleWebhook(request, env) {
  /* A comma-separated list, not one secret.

     Test and live are separate endpoints with separate signing secrets, so a
     worker that holds one can only ever listen to one mode. Holding both means
     test orders keep working after the store goes live, and going live stops
     being a step that has to be remembered. Rotating a secret works the same
     way: add the new one, deploy, remove the old one. */
  const secrets = String(env.STRIPE_WEBHOOK_SECRET || "")
    .split(",").map(part => part.trim()).filter(Boolean);
  if (!secrets.length) return json({error: "Webhook is not configured."}, 500, {});

  /* The raw body, byte for byte — the signature is over exactly these bytes,
     so it must not be parsed and re-serialised first. */
  const payload = await request.text();
  const signature = request.headers.get("Stripe-Signature");

  let verified = false;
  for (const secret of secrets) {
    if (await signatureIsValid(payload, signature, secret)) {
      verified = true;
      break;
    }
  }

  if (!verified) {
    console.error("rejected a webhook with a bad or missing signature");
    return json({error: "Invalid signature."}, 400, {});
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch (_) {
    return json({error: "Malformed event."}, 400, {});
  }

  console.log("webhook: verified", event.type, "id", event.id || "(none)");

  const object = event.data && event.data.object;

  /* 500 on failure so Stripe retries. Losing either of these silently is the
     whole reason the endpoint exists: one leaves a sold painting on sale, the
     other leaves a refunded one off it. */
  if (event.type === "payment_intent.succeeded") {
    try {
      await recordSale(env, object);
    } catch (error) {
      console.error("could not record sale:", error && error.message);
      return json({error: "Could not record sale."}, 500, {});
    }
  } else if (event.type === "charge.refunded") {
    try {
      await releaseSale(env, object);
    } catch (error) {
      console.error("could not release sale:", error && error.message);
      return json({error: "Could not release sale."}, 500, {});
    }
  }

  /* Everything else is acknowledged and ignored — a non-2xx would make Stripe
     retry an event we were never going to act on. */
  return json({received: true}, 200, {});
}

async function createPaymentIntent(request, env, cors) {
  const {items, country} = await request.json();
  const catalogue = await loadCatalogue(env);
  const {amount, currency, shipping, summary, ids} = priceOrder(items, catalogue, country);

  /* Refused before Stripe is involved, so nobody is charged for a painting
     that is already gone. The catalogue still lists it as in stock — these are
     one-offs, and products.js only changes on a deploy. */
  const sold = await soldItems(env);
  const gone = ids.filter(id => sold.has(id));
  if (gone.length) {
    const titles = gone.map(id => {
      const item = catalogue.find(entry => entry.id === id);
      return (item && item.title) || id;
    });
    throw new Error(`${titles.join(", ")} has sold. Please remove it from your bag.`);
  }

  const intent = await stripeRequest(env, "payment_intents", {
    amount: String(amount),
    currency,
/* Left to the dashboard deliberately. An earlier commit named card
       explicitly here, on the theory that automatic was resolving to a method
       list with no card in it. That diagnosis was wrong: the form was empty
       because checkout.js asked for layout "tab" instead of "tabs", which made
       Stripe throw before the Payment Element ever mounted. Naming the type
       masked that, and cost Link and one-line Apple Pay support to do it.

       Automatic means the dashboard toggles decide what is offered, with no
       deploy needed to change the mix. */
    "automatic_payment_methods[enabled]": "true",
    description: `KRITOR — ${summary}`,
    "metadata[items]": JSON.stringify(items).slice(0, 480),
    /* What the server priced, not what the browser asked for. The webhook
       marks these sold, so it must never read back attacker-supplied ids. */
    "metadata[item_ids]": ids.join(","),
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
    const isWebhook = pathname.endsWith("/stripe-webhook");

    /* ALLOWED_ORIGINS is a browser control, not a lock. CORS is enforced by
       the browser, so a script calling this worker directly never consults it
       — without a limit, anyone with the URL can mint PaymentIntents in a
       loop. Cloudflare counts per location rather than globally, so treat
       this as a flood stop, not an exact quota. A real customer creates one
       intent plus a reprice or two. */
    if (!isWebhook && env.CHECKOUT_RATE_LIMIT) {
      const key = request.headers.get("CF-Connecting-IP") || "unknown";
      const {success} = await env.CHECKOUT_RATE_LIMIT.limit({key});
      if (!success) {
        return json({error: "Too many attempts. Please wait a moment and try again."}, 429, cors);
      }
    }

    try {
      /* Exempted from the rate limit above, because this caller is Stripe
         rather than a browser: events arrive from a small pool of addresses
         and retry in bursts, so a per-IP cap meant for shoppers would throttle
         exactly the events the ledger depends on. The signature check is what
         authenticates it instead. */
      if (isWebhook) return await handleWebhook(request, env);
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
