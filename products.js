/* KRITOR STORE — shop inventory.

   This list is INDEPENDENT of the catalogue (artworks.js). The catalogue is the
   complete artistic archive; this is only what is for sale. An item here does
   not need to exist in the catalogue, and a catalogue work is never for sale
   unless it is listed here.

   ADDING AN ITEM
   Drop the product photographs into  shop/<item-id>/  and add an entry below.
   The deploy builds every rendition the store needs from these originals.
   See shop/README.md for the full workflow.

   FIELDS
     id          unique, url-safe. Becomes /shop/<id>/
     title       display name
     year        optional
     price       in cents (integer). 42000 = $420.00
     currency    ISO code, must match the Stripe account
     images      array of paths, first is the grid/hero image
     size        display string
     materials   display string
     edition     e.g. "Original", "Edition of 25"
     stock       integer. 0 hides the buy button and shows SOLD OUT
     maxPerOrder optional cap on the quantity selector (defaults to stock)
     unlisted    true hides it from /store/ while leaving /shop/<id>/ working
     shipping    display string shown on the product page
     shippingCents  postage in cents by destination, e.g.
                    {AU: 3500, NZ: 6500, default: 9500}. Charged once per item,
                    not per unit. Omit and the worker's flat table applies.
                    THESE ARE PLACEHOLDERS — they repeat the old flat rate for
                    every item so nothing changed when per-item postage landed.
                    Replace each with a real quote: a 15x10cm board and a
                    70x90cm canvas do not cost the same to send.
     description optional long text, revealed by the Text toggle
*/
const SHOP_ITEMS = [
  /* TEMPORARY — remove once the live payment path is confirmed.
     Priced at the $1 floor so a real card can be put through the live keys for
     the smallest amount the checkout allows. Shipping is added server-side, so
     the order comes to $36.00 and a refund leaves Stripe's fee behind, around
     90c. unlisted keeps it off /store/; reach it at /shop/live-payment-test/. */
  {
    id: "live-payment-test",
    title: "Live Payment Test",
    price: 100,
    currency: "AUD",
    images: ["images/work-07.png"],
    size: "—",
    materials: "Not a real item",
    edition: "Internal test",
    stock: 1,
    shippingCents: {AU: 3500, NZ: 6500, default: 9500},
    unlisted: true,
    shipping: "Not shipped. This listing exists to verify the checkout.",
    description: "A placeholder used to confirm live card payments. Not for sale."
  },
  {
    id: "artshed-original",
    title: "ArtShed",
    year: 2025,
    price: 320000,
    currency: "AUD",
    images: ["images/work-05.png"],
    size: "70 × 90 cm",
    materials: "Mixed media on canvas",
    edition: "Original",
    stock: 1,
    shippingCents: {AU: 3500, NZ: 6500, default: 9500},
    shipping: "Rolled and shipped from Melbourne. 2–3 weeks.",
    description: ""
  },
  {
    id: "yung-brother-original",
    title: "Yung Brother",
    year: 2026,
    price: 180000,
    currency: "AUD",
    images: ["images/work-08.png"],
    size: "30 × 40 cm",
    materials: "Mixed media on canvas",
    edition: "Original",
    stock: 1,
    shippingCents: {AU: 3500, NZ: 6500, default: 9500},
    shipping: "Rolled and shipped from Melbourne. 2–3 weeks.",
    description: ""
  },
  {
    id: "her-face-original",
    title: "Her Face",
    year: 2023,
    price: 180000,
    currency: "AUD",
    images: ["images/work-04.png"],
    size: "30 × 40 cm",
    materials: "Mixed media on canvas",
    edition: "Original",
    stock: 1,
    shippingCents: {AU: 3500, NZ: 6500, default: 9500},
    shipping: "Rolled and shipped from Melbourne. 2–3 weeks.",
    description: ""
  },
  {
    id: "painters-retreat-study",
    title: "Painters Retreat Study",
    year: 2025,
    price: 95000,
    currency: "AUD",
    images: ["images/work-07.png"],
    size: "15 × 10 cm",
    materials: "Mixed media on board",
    edition: "Original",
    stock: 1,
    shippingCents: {AU: 3500, NZ: 6500, default: 9500},
    shipping: "Rolled and shipped from Melbourne. 2–3 weeks.",
    description: ""
  }
];

if (typeof window !== "undefined") window.SHOP_ITEMS = SHOP_ITEMS;
if (typeof module !== "undefined" && module.exports) module.exports = { SHOP_ITEMS };
