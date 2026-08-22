# Adding to the KRITOR store

The store and the catalogue are deliberately separate. Adding a work to the
catalogue never puts it up for sale, and putting something up for sale never
changes the archive.

| | Catalogue | Store |
|---|---|---|
| Data file | `artworks.js` (`ARTWORKS`) | `products.js` (`SHOP_ITEMS`) |
| Images live in | `images/` | `shop/<item-id>/` |
| Page | `/` | `/store/` |
| Item page | `/work-01/` | `/shop/<item-id>/` |

Both go through the same image pipeline: `tools/build-images.py` reads
`artworks.js` and `products.js`, and the Pages workflow runs it on every deploy
to produce AVIF/WebP renditions and blur placeholders. You never generate
thumbnails by hand, and there is nothing to commit.

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

**4. Push.** The deploy builds the renditions for your new photographs
automatically — several widths in AVIF and WebP, plus the tiny inline
placeholder the grid paints first. Nothing is committed back, and the store
never serves your full-size originals.

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
