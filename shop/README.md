# Adding to the KRITOR store

The store and the catalogue are deliberately separate. Adding a work to the
catalogue never puts it up for sale, and putting something up for sale never
changes the archive.

| | Catalogue | Store |
|---|---|---|
| Data file | `artworks.js` (`ARTWORKS`) | `products.js` (`SHOP_ITEMS`) |
| Images live in | `images/` | `shop/<item-id>/` |
| Thumbnails generated into | `images/thumbs/` | `shop/<item-id>/thumbs/` |
| Workflow | `.github/workflows/generate-thumbnails.yml` | `.github/workflows/generate-shop-thumbnails.yml` |
| Page | `/` | `/store/` |
| Item page | `/work-01/` | `/shop/<item-id>/` |

---

## Adding a shop item

**1. Make the folder.** One folder per item, named with the id you want in
the URL — lowercase, hyphens, no spaces:

```
shop/artshed-original/
```

**2. Drop the photographs in.** Any `.jpg` / `.jpeg` / `.png`. The first image
listed in `products.js` is the one the store grid uses, so name them so the
order is obvious:

```
shop/artshed-original/01-front.png
shop/artshed-original/02-detail.png
shop/artshed-original/03-framed.png
```

**3. Add the entry** to `products.js`:

```js
{
  id: "artshed-original",
  title: "ArtShed",
  year: 2025,
  price: 320000,                 // cents — 320000 = $3,200.00
  currency: "AUD",
  images: [
    "shop/artshed-original/01-front.png",
    "shop/artshed-original/02-detail.png"
  ],
  size: "70 × 90 cm",
  materials: "Mixed media on canvas",
  edition: "Original",
  stock: 1,                      // 0 = SOLD OUT, button hides
  shipping: "Rolled and shipped from Melbourne. 2–3 weeks.",
  description: ""                // optional, shown behind the Text toggle
}
```

**4. Push.** `generate-shop-thumbnails.yml` builds
`shop/artshed-original/thumbs/*.webp` and commits them back. The store page
prefers the thumbnail and falls back to the full image if it isn't there yet,
so the item is live immediately either way.

The item page appears at `/shop/artshed-original/` — no extra file needed, the
`/shop/` directory resolves any id via `product.html`.

---

## Pricing

`price` is an **integer in the smallest currency unit** — cents for AUD. This
is what Stripe expects, and keeping it in cents avoids floating-point rounding
on totals.

```
$95.00     ->  9500
$950.00    ->  95000
$3,200.00  ->  320000
```

Every item's `currency` must match the Stripe account's currency. Mixing
currencies inside one cart is rejected at checkout.

## Taking something off sale

Set `stock: 0` to keep the page live showing SOLD OUT, or delete the entry
entirely to remove it from the store. Neither touches the catalogue — the work
stays in `artworks.js` and stays visible in the archive.
