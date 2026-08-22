/* KRITOR STORE — embedded checkout.

   Everything happens on this page. Stripe's Payment Element and Express
   Checkout Element (Apple Pay / Google Pay) are mounted inline and confirmed
   with redirect:"if_required", so the customer is never sent to a Stripe-hosted
   page. Only wallet flows that genuinely require a bank redirect (3-D Secure on
   some cards) will hand off, and those return straight back here.

   The browser never sends prices. It sends [{id, qty}] and the worker prices
   the order from its own copy of the catalogue — a tampered bag in devtools
   cannot change what is charged. */
(function () {
  "use strict";

  const config = window.KRITOR_STORE_CONFIG || {};
  const cart = window.KritorCart;

  const notice = document.getElementById("checkout-notice");
  const body = document.getElementById("checkout-body");
  const formError = document.getElementById("form-error");
  const payButton = document.getElementById("pay-button");
  const payLabel = document.getElementById("pay-label");
  const emailInput = document.getElementById("email");

  function showNotice(html) {
    notice.innerHTML = html;
    notice.hidden = false;
    body.hidden = true;
  }

  function fail(message) {
    formError.textContent = message;
    formError.hidden = false;
    payButton.disabled = false;
    payButton.classList.remove("is-busy");
  }

  function clearError() {
    formError.hidden = true;
    formError.textContent = "";
  }

  /* ---------- order summary ---------- */

  function money(cents, code) {
    return cart ? cart.money(cents, code) : `$${((cents || 0) / 100).toFixed(2)}`;
  }

  function shippingFor(country) {
    const table = config.shipping || {};
    return Number.isFinite(table[country]) ? table[country] : (table.default || 0);
  }

  let shippingCountry = "AU";

  function renderSummary() {
    const lines = cart ? cart.lines() : [];
    const host = document.getElementById("summary-lines");
    const totals = document.getElementById("summary-totals");

    host.innerHTML = lines.map(({item, qty}) => `
      <div class="summary-line">
        <div class="summary-line-image">
          <img src="${cart.thumbFor(item)}" alt=""
               onerror="this.onerror=null;this.src='${cart.assetPath((item.images || [])[0])}'">
          <span class="summary-line-qty">${qty}</span>
        </div>
        <div class="summary-line-body">
          <span class="summary-line-title">${item.title}</span>
          <span class="summary-line-meta">${item.edition || ""}${item.size ? " · " + item.size : ""}</span>
        </div>
        <span class="summary-line-price">${money(item.price * qty, item.currency)}</span>
      </div>`).join("");

    const subtotal = cart ? cart.subtotal() : 0;
    const shipping = shippingFor(shippingCountry);
    totals.innerHTML = `
      <div><dt>Subtotal</dt><dd>${money(subtotal)}</dd></div>
      <div><dt>Shipping</dt><dd>${shipping ? money(shipping) : "—"}</dd></div>
      <div class="summary-grand"><dt>Total</dt><dd>${money(subtotal + shipping)}</dd></div>`;

    if (payLabel) payLabel.textContent = `Pay ${money(subtotal + shipping)}`;
  }

  /* ---------- guards ---------- */

  if (!cart) {
    showNotice("<p>The bag could not be loaded. Please refresh the page.</p>");
    return;
  }

  if (!cart.lines().length) {
    showNotice(`<p>Your bag is empty.</p><p><a href="/store/">Return to store</a></p>`);
    return;
  }

  renderSummary();

  if (!config.stripePublishableKey || !config.paymentApiBase) {
    showNotice(`
      <p><strong>Checkout is not configured yet.</strong></p>
      <p>Add your Stripe publishable key and the deployed payment worker URL to
      <code>store-config.js</code>, then deploy <code>backend/</code>.
      See <code>backend/README.md</code> for the full setup.</p>`);
    return;
  }

  if (typeof Stripe === "undefined") {
    showNotice("<p>Stripe could not be loaded. Check your connection and refresh.</p>");
    return;
  }

  /* ---------- Stripe ---------- */

  const stripe = Stripe(config.stripePublishableKey);
  const apiBase = String(config.paymentApiBase).replace(/\/+$/, "");
  let elements = null;
  let clientSecret = null;

  async function createIntent() {
    const response = await fetch(`${apiBase}/create-payment-intent`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        items: cart.lines().map(({item, qty}) => ({id: item.id, qty})),
        country: shippingCountry
      })
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || `Could not start checkout (${response.status}).`);
    }
    return response.json();
  }

  async function boot() {
    let intent;
    try {
      intent = await createIntent();
    } catch (error) {
      showNotice(`<p>${error.message}</p><p><a href="/store/">Return to store</a></p>`);
      return;
    }

    clientSecret = intent.clientSecret;
    body.hidden = false;

    /* Server-side totals win — if the worker priced the order differently to
       what the page showed, the customer sees the real figure before paying. */
    if (Number.isFinite(intent.amount)) {
      payLabel.textContent = `Pay ${money(intent.amount, intent.currency)}`;
    }

    elements = stripe.elements({
      clientSecret,
      appearance: {
        theme: "flat",
        variables: {
          colorPrimary: "#171716",
          colorBackground: "#f7f6f4",
          colorText: "#171716",
          colorDanger: "#8a2a20",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
          fontSizeBase: "15px",
          spacingUnit: "5px",
          borderRadius: "0px"
        },
        rules: {
          ".Input": {border: "1px solid rgba(23,23,22,.22)", boxShadow: "none", padding: "12px"},
          ".Input:focus": {border: "1px solid #171716", boxShadow: "none", outline: "none"},
          ".Label": {
            fontSize: "10px", letterSpacing: ".14em", textTransform: "uppercase",
            color: "#77746d", marginBottom: "6px"
          },
          ".Tab": {border: "1px solid rgba(23,23,22,.22)", boxShadow: "none"},
          ".Tab--selected": {border: "1px solid #171716", boxShadow: "none"}
        }
      }
    });

    /* Apple Pay / Google Pay. Only rendered when the device actually offers a
       wallet, so nothing empty is shown on a desktop without one. */
    const express = elements.create("expressCheckout", {
      buttonHeight: 48,
      buttonTheme: {applePay: "black", googlePay: "black"}
    });

    express.on("ready", event => {
      if (event && event.availablePaymentMethods) {
        document.getElementById("express-block").hidden = false;
      }
    });

    express.on("confirm", async () => {
      clearError();
      const {error} = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {return_url: `${location.origin}/checkout/`},
        redirect: "if_required"
      });
      if (error) fail(error.message || "That payment could not be completed.");
      else succeed();
    });

    express.mount("#express-element");

    const address = elements.create("address", {
      mode: "shipping",
      allowedCountries: config.shippingCountries || undefined,
      fields: {phone: "always"},
      validation: {phone: {required: "never"}}
    });

    /* Shipping is priced per destination, so re-quote when the country moves. */
    address.on("change", event => {
      const country = event && event.value && event.value.address && event.value.address.country;
      if (country && country !== shippingCountry) {
        shippingCountry = country;
        renderSummary();
        repriceIntent();
      }
    });

    address.mount("#address-element");

    const payment = elements.create("payment", {layout: "tab"});
    payment.on("ready", () => { payButton.disabled = false; });
    payment.mount("#payment-element");
  }

  /* Country changed after the intent existed — ask the worker for the new
     total and show it on the button. */
  let repricing = null;
  async function repriceIntent() {
    if (repricing) return;
    repricing = fetch(`${apiBase}/update-payment-intent`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        clientSecret,
        items: cart.lines().map(({item, qty}) => ({id: item.id, qty})),
        country: shippingCountry
      })
    }).then(async response => {
      if (!response.ok) return;
      const detail = await response.json().catch(() => null);
      if (detail && Number.isFinite(detail.amount)) {
        payLabel.textContent = `Pay ${money(detail.amount, detail.currency)}`;
      }
    }).catch(() => {}).finally(() => { repricing = null; });
  }

  function succeed() {
    const email = emailInput.value.trim();
    cart.clear();
    document.getElementById("checkout").hidden = true;
    const done = document.getElementById("checkout-done");
    document.getElementById("done-detail").textContent = email
      ? `Your order is confirmed. A receipt is on its way to ${email}.`
      : "Your order is confirmed.";
    done.hidden = false;
    window.scrollTo(0, 0);
  }

  document.getElementById("payment-form").addEventListener("submit", async event => {
    event.preventDefault();
    clearError();

    if (!emailInput.value.trim() || !emailInput.checkValidity()) {
      fail("Please enter a valid email address for your receipt.");
      emailInput.focus();
      return;
    }

    payButton.disabled = true;
    payButton.classList.add("is-busy");

    const {error} = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: `${location.origin}/checkout/`,
        receipt_email: emailInput.value.trim()
      },
      redirect: "if_required"
    });

    if (error) fail(error.message || "That payment could not be completed.");
    else succeed();
  });

  /* Returning from a 3-D Secure hand-off: the intent is already resolved, so
     show the confirmation rather than an empty form. */
  const returned = new URLSearchParams(location.search).get("payment_intent_client_secret");
  if (returned) {
    stripe.retrievePaymentIntent(returned).then(({paymentIntent}) => {
      if (paymentIntent && paymentIntent.status === "succeeded") {
        history.replaceState(history.state, "", "/checkout/");
        succeed();
      } else {
        boot();
      }
    }).catch(boot);
  } else {
    boot();
  }
})();
