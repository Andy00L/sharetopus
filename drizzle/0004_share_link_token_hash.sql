-- Generated from src/db/schema.ts on 2026-09-25 (share_links gained
-- token_hash), then edited by hand: the lock timeout and the backfill are
-- not expressible in schema.ts.
--
-- Share-link tokens and webhook secrets move to encrypted columns. An
-- encrypted token cannot be matched with a plain equality, so lookups move
-- to token_hash, the SHA-256 hex of the token (hashToken in
-- src/lib/api/tokens.ts computes the same value). Every token is still
-- plaintext here, so the backfill hashes all of them before the unique
-- constraint is added. token_hash stays nullable until a later migration,
-- after the code that writes it is deployed.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "token_hash" text;--> statement-breakpoint
UPDATE "share_links" SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex') WHERE "token_hash" IS NULL AND "token" NOT LIKE 'enc:v1:%';--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_token_hash_key" UNIQUE("token_hash");
