-- Generated from src/db/schema.ts on 2026-09-24, then edited by hand: the
-- lock timeout, the empty-table guard, RESTRICT (no CASCADE) on the two
-- DROP TABLEs, and the REVOKEs at the end are not expressible in schema.ts.
-- Drops the unused *_self_* and *_public_read policies, the two unused tables
-- (usdc_fmv_daily, wallet_credits_ledger), and two indexes that duplicate a
-- unique constraint's index; then takes every table and sequence right from
-- anon and authenticated, now and for tables created later.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.usdc_fmv_daily)
     OR EXISTS (SELECT 1 FROM public.wallet_credits_ledger) THEN
    RAISE EXCEPTION 'usdc_fmv_daily or wallet_credits_ledger holds rows: dropping them would delete data';
  END IF;
END $$;--> statement-breakpoint
DROP POLICY "usdc_fmv_daily_svc" ON "usdc_fmv_daily" CASCADE;--> statement-breakpoint
DROP POLICY "usdc_fmv_public_read" ON "usdc_fmv_daily" CASCADE;--> statement-breakpoint
DROP TABLE "usdc_fmv_daily";--> statement-breakpoint
DROP POLICY "wallet_credits_ledger_svc" ON "wallet_credits_ledger" CASCADE;--> statement-breakpoint
DROP POLICY "wallet_credits_ledger_self_select" ON "wallet_credits_ledger" CASCADE;--> statement-breakpoint
DROP TABLE "wallet_credits_ledger";--> statement-breakpoint
DROP INDEX "referral_codes_code_idx";--> statement-breakpoint
DROP INDEX "share_links_token_idx";--> statement-breakpoint
DROP POLICY "analytics_metrics_self_all" ON "analytics_metrics" CASCADE;--> statement-breakpoint
DROP POLICY "api_keys_self_select" ON "api_keys" CASCADE;--> statement-breakpoint
DROP POLICY "api_keys_self_insert" ON "api_keys" CASCADE;--> statement-breakpoint
DROP POLICY "api_keys_self_update" ON "api_keys" CASCADE;--> statement-breakpoint
DROP POLICY "content_history_self_all" ON "content_history" CASCADE;--> statement-breakpoint
DROP POLICY "failed_posts_self_all" ON "failed_posts" CASCADE;--> statement-breakpoint
DROP POLICY "platform_quotas_public_read" ON "platform_quotas" CASCADE;--> statement-breakpoint
DROP POLICY "pricing_actions_public_read" ON "pricing_actions" CASCADE;--> statement-breakpoint
DROP POLICY "principals_self_select" ON "principals" CASCADE;--> statement-breakpoint
DROP POLICY "sanctions_screenings_self_select" ON "sanctions_screenings" CASCADE;--> statement-breakpoint
DROP POLICY "scheduled_posts_self_all" ON "scheduled_posts" CASCADE;--> statement-breakpoint
DROP POLICY "social_accounts_self_all" ON "social_accounts" CASCADE;--> statement-breakpoint
DROP POLICY "social_connections_self_all" ON "social_connections" CASCADE;--> statement-breakpoint
DROP POLICY "stripe_subs_self_select" ON "stripe_subscriptions" CASCADE;--> statement-breakpoint
DROP POLICY "usage_quotas_self_select" ON "usage_quotas" CASCADE;--> statement-breakpoint
DROP POLICY "users_self_select" ON "users" CASCADE;--> statement-breakpoint
DROP POLICY "users_self_update" ON "users" CASCADE;--> statement-breakpoint
DROP POLICY "wallet_credits_self_select" ON "wallet_credits" CASCADE;--> statement-breakpoint
DROP POLICY "wallets_self_select" ON "wallets" CASCADE;--> statement-breakpoint
DROP POLICY "wallets_self_update" ON "wallets" CASCADE;--> statement-breakpoint
DROP POLICY "x402_access_log_self_select" ON "x402_access_log" CASCADE;--> statement-breakpoint
DROP POLICY "x402_charges_self_select" ON "x402_charges" CASCADE;--> statement-breakpoint
DROP POLICY "x402_refunds_self_select" ON "x402_refunds" CASCADE;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
