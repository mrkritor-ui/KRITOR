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
  stripePublishableKey: "",
  paymentApiBase: "",

  /* Countries offered in the shipping address field. */
  shippingCountries: ["AU", "NZ", "GB", "US", "CA", "SG", "JP", "DE", "FR", "IT", "ES", "NL"],

  /* Flat shipping in cents, applied per order and charged on top of the bag
     subtotal. The worker recalculates this server-side — changing it here
     alone does not change what a customer is charged. */
  shipping: {
    AU: 3500,
    default: 9500
  }
};
