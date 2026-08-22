# .well-known

Apple Pay will not appear on the store until the domain is verified, and
verification is done by serving one file from this directory.

1. Stripe Dashboard → **Settings → Payments → Payment methods → Apple Pay**
2. **Add a new domain** and enter the store's domain (no `https://`)
3. Download the association file Stripe hands you
4. Save it here as `apple-developer-merchantid-domain-association` — **no file
   extension**, exactly that name
5. Commit, push, wait for the Pages deploy, then click **Verify** in Stripe

Test and live mode keep separate domain lists, so the domain has to be added
twice — once in each — before Apple Pay works for real customers.

`.nojekyll` at the repo root is what makes GitHub Pages serve this directory at
all. Jekyll skips dot-directories, and without it Stripe's verification request
gets a 404 with nothing to explain why. Leave that file in place.

This README is ignored by the verification process and is safe to keep here.
