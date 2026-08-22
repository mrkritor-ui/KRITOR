/* KRITOR STORE — shop inventory.

   This list is INDEPENDENT of the catalogue (artworks.js). The catalogue is the
   complete artistic archive; this is only what is for sale. An item here does
   not need to exist in the catalogue, and a catalogue work is never for sale
   unless it is listed here.

   ADDING AN ITEM
   Drop the product photographs into  shop/<item-id>/  and add an entry below.
   The thumbnail workflow generates shop/<item-id>/thumbs/ automatically on push.
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
     shipping    display string shown on the product page
     description optional long text, revealed by the Text toggle
*/
const SHOP_ITEMS = [
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
    shipping: "Rolled and shipped from Melbourne. 2–3 weeks.",
    description: ""
  }
];

if (typeof window !== "undefined") window.SHOP_ITEMS = SHOP_ITEMS;
if (typeof module !== "undefined" && module.exports) module.exports = { SHOP_ITEMS };
