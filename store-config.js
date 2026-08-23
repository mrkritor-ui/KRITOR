/* KRITOR STORE — checkout configuration.

   Both values below are safe to commit. The publishable key is designed to be
   public; the secret key lives ONLY in the payment worker's environment and
   must never appear in this repository.

   1. stripePublishableKey
      Stripe Dashboard -> Developers -> API keys -> Publishable key.
      Starts with pk_test_ while testing, pk_live_ when you go live.

   2. paymentApiBase
      The deployed URL of backend/ (see backend/README.md). No trailing slash.
      The checkout calls <paymentApiBase>/create-payment-intent.

   Until both are set the checkout page shows a configuration notice instead of
   the payment form, so a half-configured store can never take a real order. */
window.KRITOR_STORE_CONFIG = {
  stripePublishableKey: "pk_live_51U76xFAPx4zaqXo08c5suFtkxPzUz7zbsggGxciD25dT31YLxg3SKDZFJCexeace0w6c6eW3tJLgH0Ot559NCBOG00af69YLlz",
  paymentApiBase: "https://kritor-payments.kritor.workers.dev",

  /* Countries offered in the shipping address field. */
  shippingCountries: ["AU", "NZ", "GB", "US", "CA", "SG", "JP", "DE", "FR", "IT", "ES", "NL"],

  /* Fallback postage in cents, for an item with no shippingCents of its own.
     Per-item rates in products.js take precedence, and the worker recalculates
     all of it server-side — changing anything here alone does not change what
     a customer is charged. */
  shipping: {
    AU: 3500,
    NZ: 6500,
    default: 9500
  }
};
