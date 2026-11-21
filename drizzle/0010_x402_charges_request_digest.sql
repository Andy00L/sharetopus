-- Generated from src/db/schema.ts on 2026-11-21, then edited by hand: the
-- lock timeout is not expressible in schema.ts.
--
-- request_digest is the SHA-256 of the canonical post-now request body,
-- written by the insert that creates the charge. A replay of the payment is
-- answered only when its body has the same digest. Nullable with no default,
-- so the column is added without rewriting rows; charges from before this
-- migration keep null.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "x402_charges" ADD COLUMN "request_digest" text;
