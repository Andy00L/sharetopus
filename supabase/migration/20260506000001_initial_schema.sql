-- ============================================================================
-- SHARETOPUS DATABASE — COMPLETE SCHEMA (v2, IMMUTABLE-fixed + full RLS)
-- Fresh Supabase project. Paste into SQL Editor and Run.
-- Recommended Supabase settings:
--   ✅ Enable Data API
--   ❌ Automatically expose new tables   (we GRANT explicitly)
--   ✅ Enable automatic RLS              (we also write ENABLE explicitly)
-- ============================================================================
BEGIN;

-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";
-- Optional, enable later for "find similar posts":
-- CREATE EXTENSION IF NOT EXISTS "vector";


-- ============================================================================
-- 2. SHARED FUNCTIONS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.reject_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; UPDATE/DELETE not permitted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Generic principal-kind enforcer (parameterized via TG_ARGV)
CREATE OR REPLACE FUNCTION public.enforce_principal_kind()
RETURNS TRIGGER AS $$
DECLARE
  required_kind text := TG_ARGV[0];
  column_name   text := COALESCE(TG_ARGV[1], 'principal_id');
  pid           text;
  actual_kind   text;
BEGIN
  EXECUTE format('SELECT ($1).%I', column_name) INTO pid USING NEW;
  IF pid IS NULL THEN RETURN NEW; END IF;
  SELECT kind INTO actual_kind FROM public.principals WHERE id = pid;
  IF actual_kind IS NULL THEN
    RAISE EXCEPTION 'principal_id % does not exist in principals', pid;
  END IF;
  IF actual_kind != required_kind THEN
    RAISE EXCEPTION
      '%: principal_id % is kind=%, required=%',
      TG_TABLE_NAME, pid, actual_kind, required_kind;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- api_keys.kind ↔ principals.kind matrix
CREATE OR REPLACE FUNCTION public.enforce_api_key_kind_matrix()
RETURNS TRIGGER AS $$
DECLARE
  required_principal_kind text;
  actual_principal_kind   text;
BEGIN
  required_principal_kind := CASE NEW.kind
    WHEN 'rest'   THEN 'clerk'
    WHEN 'mcp'    THEN 'clerk'
    WHEN 'wallet' THEN 'wallet'
    ELSE NULL
  END;
  IF required_principal_kind IS NULL THEN
    RAISE EXCEPTION 'api_keys.kind=% is not recognised', NEW.kind;
  END IF;
  SELECT kind INTO actual_principal_kind FROM public.principals WHERE id = NEW.principal_id;
  IF actual_principal_kind IS NULL THEN
    RAISE EXCEPTION 'api_keys.principal_id % does not exist', NEW.principal_id;
  END IF;
  IF actual_principal_kind != required_principal_kind THEN
    RAISE EXCEPTION
      'api_keys.kind=% requires principal.kind=%, got %',
      NEW.kind, required_principal_kind, actual_principal_kind;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- x402 status state machine
CREATE OR REPLACE FUNCTION public.x402_status_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'settled' AND NEW.status NOT IN ('settled','refunded') THEN
    RAISE EXCEPTION 'x402_charges: settled charges may only transition to refunded';
  END IF;
  IF OLD.status IN ('failed','refunded') AND NEW.status != OLD.status THEN
    RAISE EXCEPTION 'x402_charges: % is terminal', OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- social_connections status state machine
CREATE OR REPLACE FUNCTION public.social_connections_status_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('connected','expired','failed','revoked')
     AND NEW.status != OLD.status THEN
    RAISE EXCEPTION
      'social_connections.status=% is terminal, cannot transition to %',
      OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 3. IDENTITY — principals (supertype) + users + wallets
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.principals (
  id          text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('clerk','wallet')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_principals_kind_active
  ON public.principals (kind) WHERE deleted_at IS NULL;
CREATE TRIGGER on_principals_update BEFORE UPDATE ON public.principals
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.users (
  id                  text PRIMARY KEY REFERENCES public.principals(id) ON DELETE CASCADE,
  email               citext NOT NULL UNIQUE,
  first_name          text NULL,
  last_name           text NULL,
  stripe_customer_id  text NOT NULL UNIQUE,
  locale              text NULL,
  timezone            text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER on_users_update BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.wallets (
  id                    text PRIMARY KEY REFERENCES public.principals(id) ON DELETE CASCADE,
  address               text NOT NULL UNIQUE,
  chain                 text NOT NULL DEFAULT 'base'
                        CHECK (chain IN ('base','base-sepolia','polygon','arbitrum')),
  display_name          text NULL,
  ens_name              text NULL,
  sanctions_status      text NOT NULL DEFAULT 'unchecked'
                        CHECK (sanctions_status IN ('unchecked','clean','sanctioned')),
  sanctions_checked_at  timestamptz NULL,
  registered_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_wallets_sanctions
  ON public.wallets (sanctions_status) WHERE sanctions_status != 'clean';

COMMENT ON COLUMN public.wallets.id IS
  'Convention: "wallet:" || lower(address). Identical to principals.id.';


-- ============================================================================
-- 4. CREDENTIALS — api_keys, MCP OAuth registry & sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id  text NOT NULL REFERENCES public.principals(id) ON DELETE CASCADE,
  name          text NOT NULL,
  prefix        text NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('rest','mcp','wallet')),
  scopes        text[] NOT NULL DEFAULT
                ARRAY['post.write','account.read','schedule.read']::text[],
  expires_at    timestamptz NULL,
  last_used_at  timestamptz NULL,
  last_used_ip  text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_api_keys_principal_active
  ON public.api_keys (principal_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
  ON public.api_keys (prefix) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_kind_active
  ON public.api_keys (kind) WHERE revoked_at IS NULL;
CREATE TRIGGER api_keys_kind_principal_match
  BEFORE INSERT OR UPDATE OF principal_id, kind ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.enforce_api_key_kind_matrix();

CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  client_id              text PRIMARY KEY,
  client_name            text NOT NULL,
  redirect_uris          text[] NOT NULL,
  software_id            text NULL,
  software_version       text NULL,
  registered_by_user_id  text NULL REFERENCES public.users(id) ON DELETE SET NULL,
  trust_level            text NOT NULL DEFAULT 'unverified'
                         CHECK (trust_level IN ('unverified','verified','blocked')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  revoked_at             timestamptz NULL,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_clients_trust
  ON public.mcp_oauth_clients (trust_level) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.mcp_sessions (
  id                text PRIMARY KEY,
  principal_id      text NOT NULL REFERENCES public.principals(id) ON DELETE CASCADE,
  oauth_client_id   text NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE SET NULL,
  api_key_id        uuid NULL REFERENCES public.api_keys(id) ON DELETE SET NULL,
  protocol_version  text NOT NULL DEFAULT '2025-06-18',
  started_at        timestamptz NOT NULL DEFAULT now(),
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz NULL,
  client_name       text NULL,
  client_version    text NULL,
  ip_hash           text NULL
);
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_principal_active
  ON public.mcp_sessions (principal_id) WHERE ended_at IS NULL;
CREATE TRIGGER mcp_sessions_must_be_clerk
  BEFORE INSERT OR UPDATE OF principal_id ON public.mcp_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_principal_kind('clerk', 'principal_id');


-- ============================================================================
-- 5. COMPLIANCE — sanctions screenings, SIWE nonces
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.sanctions_screenings (
  id            bigserial PRIMARY KEY,
  wallet_id     text NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  result        text NOT NULL CHECK (result IN ('clean','sanctioned','error')),
  source        text NOT NULL,
  raw_response  jsonb NULL,
  checked_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sanctions_wallet_time
  ON public.sanctions_screenings (wallet_id, checked_at DESC);
CREATE TRIGGER block_sanctions_mutation BEFORE UPDATE OR DELETE
  ON public.sanctions_screenings FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

CREATE TABLE IF NOT EXISTS public.siwe_nonces (
  nonce       text PRIMARY KEY,
  wallet      text NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_siwe_nonces_expiry
  ON public.siwe_nonces (expires_at);


-- ============================================================================
-- 6. SOCIAL — accounts + connections (cyclic FKs added in §11)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.social_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id       text NOT NULL REFERENCES public.principals(id) ON DELETE CASCADE,
  platform           text NOT NULL CHECK (platform IN
                       ('linkedin','tiktok','pinterest','instagram',
                        'facebook','threads','youtube','x')),
  account_identifier text NOT NULL,
  display_name       text NULL,
  username           text NULL,
  email_address      citext NULL,
  avatar_url         text NULL,
  is_verified        boolean NULL,
  follower_count     bigint NULL,
  following_count    bigint NULL,
  bio_description    text NULL,
  is_available       boolean NOT NULL DEFAULT true,
  access_token       text NULL,
  refresh_token      text NULL,
  token_expires_at   timestamptz NULL,
  connection_id      text NULL,                   -- FK added in §11
  extra              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz NULL,
  CONSTRAINT social_accounts_unique_per_principal
    UNIQUE (principal_id, platform, account_identifier)
);
CREATE INDEX IF NOT EXISTS idx_social_accounts_principal_active
  ON public.social_accounts (principal_id)
  WHERE deleted_at IS NULL AND is_available = true;
CREATE INDEX IF NOT EXISTS idx_social_accounts_token_expiry
  ON public.social_accounts (token_expires_at)
  WHERE deleted_at IS NULL AND token_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_accounts_connection
  ON public.social_accounts (connection_id) WHERE connection_id IS NOT NULL;
CREATE TRIGGER on_social_accounts_update BEFORE UPDATE ON public.social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.social_connections (
  id                       text PRIMARY KEY,                -- 'conn_' || nanoid
  principal_id             text NOT NULL REFERENCES public.principals(id) ON DELETE CASCADE,
  initiated_via            text NOT NULL CHECK (initiated_via IN ('web','mcp','api','x402')),
  initiated_x402_charge_id uuid NULL,                        -- FK added in §11
  platform                 text NOT NULL CHECK (platform IN
                            ('linkedin','tiktok','pinterest','instagram',
                             'facebook','threads','youtube','x')),
  oauth_state              text NOT NULL UNIQUE,
  oauth_code_verifier      text NULL,
  redirect_uri             text NOT NULL,
  status                   text NOT NULL DEFAULT 'pending'
                            CHECK (status IN
                              ('pending','connected','expired','failed','revoked')),
  expires_at               timestamptz NOT NULL,
  connected_at             timestamptz NULL,
  failed_at                timestamptz NULL,
  error_code               text NULL,
  error_message            text NULL,
  social_account_id        uuid NULL REFERENCES public.social_accounts(id) ON DELETE SET NULL,
  poll_count               int NOT NULL DEFAULT 0,
  last_polled_at           timestamptz NULL,
  last_polled_ip_hash      text NULL,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_social_connections_principal
  ON public.social_connections (principal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_connections_status_expiry
  ON public.social_connections (status, expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_social_connections_account
  ON public.social_connections (social_account_id) WHERE social_account_id IS NOT NULL;
CREATE TRIGGER on_social_connections_update BEFORE UPDATE ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER social_connections_status_guard_trigger
  BEFORE UPDATE ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION public.social_connections_status_guard();


-- ============================================================================
-- 7. POSTING — scheduled, failed, content history, analytics
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.scheduled_posts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id             text NOT NULL REFERENCES public.principals(id) ON DELETE CASCADE,
  social_account_id        uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform                 text NOT NULL,
  status                   text NOT NULL DEFAULT 'scheduled'
                            CHECK (status IN
                              ('scheduled','processing','posted','failed','cancelled')),
  scheduled_at             timestamptz NOT NULL,
  posted_at                timestamptz NULL,
  scheduled_at_date        date GENERATED ALWAYS AS
                            ((scheduled_at AT TIME ZONE 'UTC')::date) STORED,
  post_title               text NULL,
  post_description         text NULL,
  post_options             jsonb NOT NULL DEFAULT '{}'::jsonb,
  media_type               text NOT NULL CHECK (media_type IN ('text','image','video')),
  media_storage_path       text NOT NULL DEFAULT '',
  cover_image_timestamp    numeric NULL,
  batch_id                 text NULL,
  error_message            text NULL,
  retry_count              int NOT NULL DEFAULT 0,
  created_via              text NOT NULL DEFAULT 'web'
                            CHECK (created_via IN ('web','mcp','x402','api')),
  idempotency_key          text NULL,
  x402_charge_id           uuid NULL,                        -- FK added in §11
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status_due
  ON public.scheduled_posts (status, scheduled_at)
  WHERE status IN ('scheduled','processing');
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_principal_platform_window
  ON public.scheduled_posts (principal_id, platform, scheduled_at)
  WHERE status IN ('scheduled','processing');
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_principal_recent
  ON public.scheduled_posts (principal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_batch
  ON public.scheduled_posts (batch_id) WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_posts_idempotency
  ON public.scheduled_posts (principal_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE TRIGGER on_scheduled_posts_update BEFORE UPDATE ON public.scheduled_posts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.failed_posts (
  LIKE public.scheduled_posts INCLUDING ALL
);
ALTER TABLE public.failed_posts ALTER COLUMN status SET DEFAULT 'failed';

CREATE TABLE IF NOT EXISTS public.content_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id       text NOT NULL REFERENCES public.principals(id) ON DELETE CASCADE,
  social_account_id  uuid NULL REFERENCES public.social_accounts(id) ON DELETE SET NULL,
  scheduled_post_id  uuid NULL REFERENCES public.scheduled_posts(id) ON DELETE SET NULL,
  platform           text NOT NULL,
  content_id         text NOT NULL,
  title              text NULL,
  description        text NULL,
  media_url          text NULL,
  media_type         text NULL,
  status             text NULL,
  batch_id           text NULL,
  created_via        text NOT NULL DEFAULT 'web'
                      CHECK (created_via IN ('web','mcp','x402','api')),
  extra              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_history_principal_time
  ON public.content_history (principal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_history_batch
  ON public.content_history (batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.analytics_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id  text NOT NULL REFERENCES public.principals(id) ON DELETE CASCADE,
  platform      text NOT NULL,
  content_id    text NULL,
  metric_date   date NOT NULL DEFAULT CURRENT_DATE,
  views         bigint NOT NULL DEFAULT 0,
  comments      bigint NOT NULL DEFAULT 0,
  likes         bigint NOT NULL DEFAULT 0,
  shares        bigint NOT NULL DEFAULT 0,
  subscribers   bigint NOT NULL DEFAULT 0,
  extra         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_unique_daily
    UNIQUE (principal_id, platform, content_id, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_analytics_principal_platform_date
  ON public.analytics_metrics (principal_id, platform, metric_date DESC);
CREATE TRIGGER on_analytics_update BEFORE UPDATE ON public.analytics_metrics
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ============================================================================
-- 8. STRIPE — subscriptions + invoices
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.stripe_subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_subscription_id   text NOT NULL UNIQUE,
  stripe_customer_id       text NOT NULL,
  stripe_price_id          text NULL,
  plan                     text NULL,
  status                   text NOT NULL,
  start_date               timestamptz NOT NULL,
  end_date                 timestamptz NULL,
  current_period_end       timestamptz NULL,
  cancel_reason            text NULL,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stripe_subs_user_active
  ON public.stripe_subscriptions (user_id) WHERE status IN ('active','trialing');
CREATE TRIGGER on_stripe_subs_update BEFORE UPDATE ON public.stripe_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.stripe_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_invoice_id   text NULL UNIQUE,
  amount_paid_cents   int NULL,
  currency            text NULL,
  status              text NULL,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER block_stripe_invoices_mutation BEFORE UPDATE OR DELETE
  ON public.stripe_invoices FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();


-- ============================================================================
-- 9. WALLET / x402 — pricing, credits, charges, refunds, FMV
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pricing_actions (
  action            text PRIMARY KEY,
  display_name      text NOT NULL,
  usdc_price        numeric(18,6) NOT NULL CHECK (usdc_price >= 0),
  description       text NULL,
  recurrence        text NOT NULL DEFAULT 'one_time'
                    CHECK (recurrence IN ('one_time','monthly')),
  effective_from    timestamptz NOT NULL DEFAULT now(),
  effective_until   timestamptz NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER on_pricing_update BEFORE UPDATE ON public.pricing_actions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.wallet_credits (
  wallet_id      text PRIMARY KEY REFERENCES public.wallets(id) ON DELETE CASCADE,
  balance_usdc   numeric(18,6) NOT NULL DEFAULT 0
                 CHECK (balance_usdc >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER on_wallet_credits_update BEFORE UPDATE ON public.wallet_credits
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.wallet_credits_ledger (
  id                bigserial PRIMARY KEY,
  wallet_id         text NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  delta_usdc        numeric(18,6) NOT NULL,
  reason            text NOT NULL CHECK (reason IN ('topup','spend','refund','adjustment')),
  related_charge_id uuid NULL,                                -- FK added in §11
  related_action    text NULL REFERENCES public.pricing_actions(action),
  idempotency_key   text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_idempotency_unique UNIQUE (wallet_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet_time
  ON public.wallet_credits_ledger (wallet_id, created_at DESC);
CREATE TRIGGER block_ledger_mutation BEFORE UPDATE OR DELETE
  ON public.wallet_credits_ledger FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

CREATE TABLE IF NOT EXISTS public.x402_charges (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id          text NOT NULL REFERENCES public.principals(id) ON DELETE RESTRICT,
  wallet_id             text NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  action                text NOT NULL REFERENCES public.pricing_actions(action),
  amount_usdc           numeric(18,6) NOT NULL CHECK (amount_usdc > 0),
  amount_usd_at_receipt numeric(18,6) NULL,
  network               text NOT NULL DEFAULT 'base',
  asset                 text NOT NULL DEFAULT 'USDC',
  nonce                 text NOT NULL UNIQUE,
  request_id            text NULL UNIQUE,
  payer_address         text NOT NULL,
  recipient_address     text NOT NULL,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','settled','failed','refunded')),
  facilitator           text NOT NULL DEFAULT 'coinbase',
  facilitator_fee_usdc  numeric(18,6) NULL,
  tx_hash               text NULL,
  block_number          bigint NULL,
  scheduled_post_id     uuid NULL REFERENCES public.scheduled_posts(id) ON DELETE SET NULL,
  social_connection_id  text NULL REFERENCES public.social_connections(id) ON DELETE SET NULL,
  error_message         text NULL,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  settled_at            timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_x402_principal_time
  ON public.x402_charges (principal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_x402_pending_aged
  ON public.x402_charges (created_at) WHERE status = 'pending';
-- FIX: was date_trunc('month', settled_at) — STABLE on timestamptz.
-- Index settled_at directly; range queries serve monthly rollups equally well.
CREATE INDEX IF NOT EXISTS idx_x402_settled_at
  ON public.x402_charges (settled_at) WHERE status = 'settled';
CREATE TRIGGER x402_charges_must_be_wallet
  BEFORE INSERT OR UPDATE OF principal_id ON public.x402_charges
  FOR EACH ROW EXECUTE FUNCTION public.enforce_principal_kind('wallet', 'principal_id');
CREATE TRIGGER x402_status_guard_trigger BEFORE UPDATE ON public.x402_charges
  FOR EACH ROW EXECUTE FUNCTION public.x402_status_guard();

CREATE TABLE IF NOT EXISTS public.x402_refunds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id       uuid NOT NULL REFERENCES public.x402_charges(id) ON DELETE RESTRICT,
  reason          text NOT NULL,
  refunded_usdc   numeric(18,6) NOT NULL CHECK (refunded_usdc > 0),
  refund_tx_hash  text NULL,
  initiated_by    text NULL REFERENCES public.principals(id) ON DELETE SET NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refunds_charge ON public.x402_refunds (charge_id);
CREATE TRIGGER block_refunds_mutation BEFORE UPDATE OR DELETE
  ON public.x402_refunds FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

CREATE TABLE IF NOT EXISTS public.usdc_fmv_daily (
  fmv_date     date PRIMARY KEY,
  usd_per_usdc numeric(18,8) NOT NULL,
  source       text NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);


-- ============================================================================
-- 10. OBSERVABILITY — audit, quotas, rate limits
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mcp_audit_log (
  id               bigserial PRIMARY KEY,
  principal_id     text NULL REFERENCES public.principals(id) ON DELETE SET NULL,
  oauth_client_id  text NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE SET NULL,
  api_key_id       uuid NULL REFERENCES public.api_keys(id) ON DELETE SET NULL,
  session_id       text NULL,
  tool_name        text NOT NULL,
  args_redacted    jsonb NULL,
  result_status    text NOT NULL CHECK (result_status IN
                     ('ok','error','denied','rate_limited','quota_exceeded')),
  latency_ms       int NULL,
  ip_hash          text NULL,
  user_agent       text NULL,
  -- FIX: was date_trunc('month', created_at)::date — STABLE on timestamptz.
  -- AT TIME ZONE 'UTC' converts to timestamp (immutable when zone constant),
  -- then date_trunc on timestamp is immutable.
  month            date GENERATED ALWAYS AS
                     (date_trunc('month', created_at AT TIME ZONE 'UTC')::date) STORED,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_principal_time
  ON public.mcp_audit_log (principal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tool_time
  ON public.mcp_audit_log (tool_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_month
  ON public.mcp_audit_log (month);
CREATE TRIGGER block_audit_mutation BEFORE UPDATE OR DELETE
  ON public.mcp_audit_log FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
CREATE TRIGGER mcp_audit_must_be_clerk
  BEFORE INSERT OR UPDATE OF principal_id ON public.mcp_audit_log
  FOR EACH ROW WHEN (NEW.principal_id IS NOT NULL)
  EXECUTE FUNCTION public.enforce_principal_kind('clerk', 'principal_id');

CREATE TABLE IF NOT EXISTS public.x402_access_log (
  id              bigserial PRIMARY KEY,
  principal_id    text NULL REFERENCES public.principals(id) ON DELETE SET NULL,
  wallet_id       text NULL REFERENCES public.wallets(id) ON DELETE SET NULL,
  endpoint        text NOT NULL,
  action          text NULL REFERENCES public.pricing_actions(action),
  charge_id       uuid NULL REFERENCES public.x402_charges(id) ON DELETE SET NULL,
  result_status   text NOT NULL CHECK (result_status IN
                    ('ok','402_required','sanctioned','rate_limited','error')),
  latency_ms      int NULL,
  ip_hash         text NULL,
  user_agent      text NULL,
  -- FIX (same as above)
  month           date GENERATED ALWAYS AS
                    (date_trunc('month', created_at AT TIME ZONE 'UTC')::date) STORED,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_x402_log_wallet_time
  ON public.x402_access_log (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_x402_log_month
  ON public.x402_access_log (month);
CREATE TRIGGER block_x402_log_mutation BEFORE UPDATE OR DELETE
  ON public.x402_access_log FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

CREATE TABLE IF NOT EXISTS public.usage_quotas (
  principal_id    text NOT NULL REFERENCES public.principals(id) ON DELETE CASCADE,
  period          date NOT NULL,
  action          text NOT NULL,
  count           int NOT NULL DEFAULT 0,
  PRIMARY KEY (principal_id, period, action)
);
CREATE INDEX IF NOT EXISTS idx_usage_quotas_period
  ON public.usage_quotas (period);

CREATE TABLE IF NOT EXISTS public.platform_quotas (
  platform       text PRIMARY KEY,
  daily_cap      int NOT NULL,
  burst_cap_60s  int NOT NULL,
  notes          text NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id            bigserial PRIMARY KEY,
  principal_id  text NULL REFERENCES public.principals(id) ON DELETE SET NULL,
  ip_hash       text NULL,
  scope         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rl_events_principal_time
  ON public.rate_limit_events (principal_id, created_at DESC)
  WHERE principal_id IS NOT NULL;


-- ============================================================================
-- 11. CROSS-TABLE FOREIGN KEYS (resolve cycles)
-- ============================================================================
ALTER TABLE public.social_accounts
  ADD CONSTRAINT social_accounts_connection_fk
  FOREIGN KEY (connection_id) REFERENCES public.social_connections(id) ON DELETE SET NULL;

ALTER TABLE public.social_connections
  ADD CONSTRAINT social_connections_x402_charge_fk
  FOREIGN KEY (initiated_x402_charge_id) REFERENCES public.x402_charges(id) ON DELETE SET NULL;

ALTER TABLE public.scheduled_posts
  ADD CONSTRAINT scheduled_posts_x402_charge_fk
  FOREIGN KEY (x402_charge_id) REFERENCES public.x402_charges(id) ON DELETE SET NULL;

ALTER TABLE public.wallet_credits_ledger
  ADD CONSTRAINT ledger_charge_fk
  FOREIGN KEY (related_charge_id) REFERENCES public.x402_charges(id) ON DELETE SET NULL;


-- ============================================================================
-- 12. ROW LEVEL SECURITY — service-role policies on every table
-- (service_role always bypasses RLS, but explicit policies keep intent visible)
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'principals','users','wallets','api_keys','mcp_oauth_clients','mcp_sessions',
    'sanctions_screenings','siwe_nonces',
    'social_accounts','social_connections',
    'scheduled_posts','failed_posts','content_history','analytics_metrics',
    'stripe_subscriptions','stripe_invoices',
    'pricing_actions','wallet_credits','wallet_credits_ledger',
    'x402_charges','x402_refunds','usdc_fmv_daily',
    'mcp_audit_log','x402_access_log','usage_quotas','platform_quotas',
    'rate_limit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_svc', t
    );
  END LOOP;
END $$;


-- ============================================================================
-- 13. SELF-OWNED RLS — works for BOTH Clerk users and wallets
--
-- Convention: auth.jwt() ->> 'sub' equals public.principals.id
--   • For Clerk users:  sub = "user_xxx"        (Clerk's user id)
--   • For wallet users: sub = "wallet:0xabc..." (issued by your custom JWT
--                                                after wallet API key + SIWE
--                                                validation; do this in your
--                                                Next.js route handler)
--
-- If you go pure service-role (route handlers always use adminSupabase),
-- these policies are dormant and harmless. They become active the moment
-- you ever issue a JWT for a wallet session.
-- ============================================================================

-- principals: a principal can see its own row
CREATE POLICY principals_self_select ON public.principals
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = id);

-- users: Clerk user can see/update their own row
CREATE POLICY users_self_select ON public.users
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = id);
CREATE POLICY users_self_update ON public.users
  FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'sub' = id)
  WITH CHECK (auth.jwt() ->> 'sub' = id);

-- wallets: wallet can see its own row
CREATE POLICY wallets_self_select ON public.wallets
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = id);
CREATE POLICY wallets_self_update ON public.wallets
  FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'sub' = id)
  WITH CHECK (auth.jwt() ->> 'sub' = id);

-- api_keys: a principal manages their own keys
CREATE POLICY api_keys_self_select ON public.api_keys
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = principal_id);
CREATE POLICY api_keys_self_insert ON public.api_keys
  FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'sub' = principal_id);
CREATE POLICY api_keys_self_update ON public.api_keys
  FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'sub' = principal_id)
  WITH CHECK (auth.jwt() ->> 'sub' = principal_id);

-- mcp_sessions: clerk principal sees its own sessions
CREATE POLICY mcp_sessions_self_select ON public.mcp_sessions
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = principal_id);

-- social_accounts
CREATE POLICY social_accounts_self_all ON public.social_accounts
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'sub' = principal_id)
  WITH CHECK (auth.jwt() ->> 'sub' = principal_id);

-- social_connections
CREATE POLICY social_connections_self_all ON public.social_connections
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'sub' = principal_id)
  WITH CHECK (auth.jwt() ->> 'sub' = principal_id);

-- scheduled_posts
CREATE POLICY scheduled_posts_self_all ON public.scheduled_posts
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'sub' = principal_id)
  WITH CHECK (auth.jwt() ->> 'sub' = principal_id);

-- failed_posts
CREATE POLICY failed_posts_self_all ON public.failed_posts
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'sub' = principal_id)
  WITH CHECK (auth.jwt() ->> 'sub' = principal_id);

-- content_history
CREATE POLICY content_history_self_all ON public.content_history
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'sub' = principal_id)
  WITH CHECK (auth.jwt() ->> 'sub' = principal_id);

-- analytics_metrics
CREATE POLICY analytics_metrics_self_all ON public.analytics_metrics
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'sub' = principal_id)
  WITH CHECK (auth.jwt() ->> 'sub' = principal_id);

-- stripe_subscriptions: read-only for the user
CREATE POLICY stripe_subs_self_select ON public.stripe_subscriptions
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = user_id);

-- wallet_credits: wallet sees its own balance
CREATE POLICY wallet_credits_self_select ON public.wallet_credits
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = wallet_id);

-- wallet_credits_ledger: wallet sees its own ledger
CREATE POLICY wallet_credits_ledger_self_select ON public.wallet_credits_ledger
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = wallet_id);

-- x402_charges: principal (wallet) sees its own charges
CREATE POLICY x402_charges_self_select ON public.x402_charges
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = principal_id);

-- x402_refunds: visible if you own the underlying charge
CREATE POLICY x402_refunds_self_select ON public.x402_refunds
  FOR SELECT TO authenticated
  USING (charge_id IN (
    SELECT id FROM public.x402_charges
    WHERE principal_id = auth.jwt() ->> 'sub'
  ));

-- sanctions_screenings: wallet can see its own screening result
CREATE POLICY sanctions_screenings_self_select ON public.sanctions_screenings
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = wallet_id);

-- usage_quotas: principal sees its own quota counters
CREATE POLICY usage_quotas_self_select ON public.usage_quotas
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = principal_id);

-- x402_access_log: wallet sees its own access log
CREATE POLICY x402_access_log_self_select ON public.x402_access_log
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'sub' = wallet_id
      OR auth.jwt() ->> 'sub' = principal_id);


-- ============================================================================
-- 14. PUBLIC-READ POLICIES — config tables agents need to discover
-- ============================================================================

-- Pricing catalog: any caller can read prices (needed before paying)
CREATE POLICY pricing_actions_public_read ON public.pricing_actions
  FOR SELECT TO authenticated, anon
  USING (effective_until IS NULL OR effective_until > now());

-- Platform quotas: public configuration
CREATE POLICY platform_quotas_public_read ON public.platform_quotas
  FOR SELECT TO authenticated, anon
  USING (true);

-- USDC FMV: public conversion rates
CREATE POLICY usdc_fmv_public_read ON public.usdc_fmv_daily
  FOR SELECT TO authenticated, anon
  USING (true);


-- ============================================================================
-- 15. DATA-API GRANTS — expose tables to authenticated/anon roles
-- (We disabled "Automatically expose new tables", so we grant explicitly.
--  RLS policies above gate row visibility within these grants.)
-- ============================================================================
GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- Tables Clerk users + wallets read/write through the Data API
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.users,
  public.wallets,
  public.principals,
  public.api_keys,
  public.social_accounts,
  public.social_connections,
  public.scheduled_posts,
  public.failed_posts,
  public.content_history,
  public.analytics_metrics
TO authenticated;

-- Read-only billing visibility
GRANT SELECT ON
  public.stripe_subscriptions,
  public.wallet_credits,
  public.wallet_credits_ledger,
  public.x402_charges,
  public.x402_refunds,
  public.sanctions_screenings,
  public.usage_quotas,
  public.x402_access_log,
  public.mcp_sessions
TO authenticated;

-- Public-read configuration
GRANT SELECT ON
  public.pricing_actions,
  public.platform_quotas,
  public.usdc_fmv_daily
TO authenticated, anon;

-- Sequences referenced by INSERTable tables
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- ============================================================================
-- 16. SEED DATA — pricing & platform quotas
-- ============================================================================
INSERT INTO public.pricing_actions
  (action, display_name, usdc_price, recurrence, description) VALUES
  ('register',         'Wallet registration',  1.00, 'one_time', 'Sybil tax + sanctions screen'),
  ('connect_account',  'Connect social acct',  0.50, 'monthly',  'OAuth refresh cost amortised'),
  ('post.text',        'Schedule text post',   0.50, 'one_time', ''),
  ('post.image',       'Schedule image post',  0.75, 'one_time', '+storage/egress'),
  ('post.video',       'Schedule video post',  1.00, 'one_time', '+50MB egress'),
  ('bulk_schedule',    'Bulk schedule (>30)',  0.50, 'one_time', 'Per call up to 30 posts'),
  ('reschedule',       'Reschedule a post',    0.10, 'one_time', ''),
  ('cancel',           'Cancel a post',        0.00, 'one_time', 'Free — no platform cost'),
  ('analytics_query',  'Analytics query',      0.05, 'one_time', ''),
  ('storage_overage',  'Storage GB-mo',        0.05, 'monthly',  'Above 1 GB free for wallets')
ON CONFLICT (action) DO NOTHING;

INSERT INTO public.platform_quotas
  (platform, daily_cap, burst_cap_60s, notes) VALUES
  ('linkedin',   100, 10, 'LinkedIn API soft limit'),
  ('tiktok',       6, 2,  'TikTok content posting'),
  ('pinterest', 1000, 30, 'Pin creation'),
  ('instagram',   25, 5,  'Graph API publishing')
ON CONFLICT (platform) DO NOTHING;


COMMIT;

-- ============================================================================
-- VERIFICATION — run these after to confirm everything is in place
-- ============================================================================
-- SELECT count(*) AS table_count   FROM pg_tables   WHERE schemaname='public';   -- 27
-- SELECT count(*) AS index_count   FROM pg_indexes  WHERE schemaname='public';   -- ~55
-- SELECT count(*) AS policy_count  FROM pg_policies WHERE schemaname='public';   -- ~52
-- SELECT count(*) AS pricing_seed  FROM public.pricing_actions;                  -- 10
-- SELECT count(*) AS quota_seed    FROM public.platform_quotas;                  -- 4