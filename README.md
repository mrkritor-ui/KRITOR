# Works — minimal art catalog

A static, no-build site: a 2-column grid of your paintings, tap to view fullscreen.
Hosted free on GitHub Pages, added to your iPad homescreen so it opens like an app.

## 1. Put it on GitHub

1. Create a new repository on GitHub (public — GitHub Pages on the free plan needs
   a public repo, unless you have GitHub Pro/Team).
2. Upload every file in this folder to the repo, keeping the folder structure
   (drag-and-drop works fine on github.com — "Add file" → "Upload files").
3. Go to the repo's **Settings → Pages**, set **Source** to your default branch
   (usually `main`) and **/ (root)**, then save.
4. GitHub gives you a URL like `https://yourname.github.io/repo-name/` —
   that's your site.

## 2. Add your paintings

1. Drop your image files into the `images` folder (jpg or png, whatever size —
   just try to keep them reasonably web-sized, under ~2–3MB each, so the grid
   scrolls smoothly).
2. Open `artworks.js` and add one entry per piece:

```js
const ARTWORKS = [
  {
    title: "Untitled I",
    year: "2024",
    size: "60 × 90 cm",
    image: "images/work-01.jpg"
  },
  {
    title: "Untitled II",
    year: "2024",
    size: "40 × 40 cm",
    image: "images/work-02.jpg"
  },
];
```

The order in the list is the order they appear on the page. Commit the change
(or upload the edited file) and the live site updates automatically, usually
within a minute.

## 3. Add it to your iPad homescreen

1. Open the GitHub Pages URL in Safari on your iPad Air 2.
2. Tap the **Share** icon (square with an arrow).
3. Tap **Add to Home Screen**.
4. It'll launch full-screen with no browser bar, using the "Works" icon.

## Notes

- No build tools, no dependencies — just HTML/CSS/JS, so it'll keep working
  indefinitely and loads instantly even on an older iPad.
- Images aren't cropped to a fixed shape — portraits and landscapes keep their
  real proportions in the grid, which felt right for a painting catalog.
- Want a different icon? Replace `icon.png` (180×180px) with your own.
- To reorder or remove a piece, just edit or delete its entry in `artworks.js`.
