-- KRITOR STORE — stock ledger.
--
-- products.json says how many of a thing exist. This says which ones are gone.
-- The worker overlays the two: an id listed here cannot be bought again,
-- whatever the catalogue still claims.
--
-- Written only by the Stripe webhook, on a signature-verified
-- payment_intent.succeeded, so a row here means money was actually taken.
--
-- Apply with:
--   npx wrangler d1 execute kritor-store --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS sold_items (
  item_id  TEXT PRIMARY KEY,
  pi_id    TEXT NOT NULL,
  sold_at  INTEGER NOT NULL
);
