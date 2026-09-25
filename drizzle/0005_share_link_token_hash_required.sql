-- Generated from src/db/schema.ts on 2026-09-25 (share_links.token_hash
-- became NOT NULL, the unique constraint on token was removed), then edited
-- by hand: the lock timeout and the backfill are not expressible in
-- schema.ts.
--
-- Applied after the deploy that writes token_hash on every new link. A
-- link created by the previous deploy between migration 0004 and that
-- deploy has no hash yet; its token is still plaintext, so it is hashed
-- here. A NULL hash next to an encrypted token cannot be recomputed in SQL,
-- and SET NOT NULL then fails the whole migration instead of losing a link.
-- The unique constraint on token is dropped: encrypted values never repeat,
-- and token_hash carries uniqueness now.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
UPDATE "share_links" SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex') WHERE "token_hash" IS NULL AND "token" NOT LIKE 'enc:v1:%';--> statement-breakpoint
ALTER TABLE "share_links" DROP CONSTRAINT "share_links_token_key";--> statement-breakpoint
ALTER TABLE "share_links" ALTER COLUMN "token_hash" SET NOT NULL;
