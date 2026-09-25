import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  pgPolicy,
  customType,
  index,
  uniqueIndex,
  foreignKey,
  unique,
  check,
  primaryKey,
  text,
  uuid,
  integer,
  bigint,
  bigserial,
  numeric,
  boolean,
  date,
  jsonb,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

// Relative on purpose: drizzle-kit loads this file outside Next.js.
import { decryptToken, encryptToken } from "../lib/crypto/tokenEncryption";

/*
 * The database schema, and the source of truth for it. Every table, index,
 * foreign key, CHECK constraint and row-level security policy in the public
 * schema is declared here.
 *
 * Changing the schema: edit this file, run `bun run db:generate` to write the
 * SQL migration into drizzle/, review it, then apply it with
 * `bun run db:migrate`. drizzle/0000_baseline.sql records the database as it
 * was when Drizzle was adopted (2026-09-23) and runs nothing. Postgres
 * functions and triggers are not declared here; docs/DATABASE.md lists them.
 *
 * Rows read through Drizzle have the shape supabase-js rows had: snake_case
 * keys, timestamps as ISO strings (see timestamptz below), numeric and
 * bigint columns as numbers.
 */

/**
 * timestamptz read back as the ISO 8601 string PostgREST returned
 * ("2026-09-23T20:26:45.1234+00:00") instead of Postgres' own text form
 * ("2026-09-23 20:26:45.1234+00"), so API responses and date parsing keep
 * the format they had before Drizzle. Writes pass the string through.
 */
const timestamptz = customType<{ data: string; driverData: string }>({
  dataType() {
    return "timestamp with time zone";
  },
  fromDriver(postgresText) {
    return postgresText.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  },
});

/** A jsonb value, the shape supabase-js typed jsonb with. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Case-insensitive text from the citext extension (installed in public). */
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

/**
 * Text encrypted with AES-256-GCM on write and decrypted on read
 * (src/lib/crypto/tokenEncryption.ts), for the OAuth tokens and API
 * credentials in social_accounts, the webhook signing secrets and the
 * share-link tokens. The column stays `text`, so no migration.
 * Values written before encryption shipped read back unchanged until the
 * encrypt-social-tokens cron rewrites them.
 *
 * Every write uses a fresh IV, so SQL cannot compare these columns to a
 * value, and operators that bind their value through the column (eq, like)
 * would compare against a fresh ciphertext: test raw values with an sql``
 * template instead.
 */
const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver(plaintext) {
    return encryptToken(plaintext);
  },
  fromDriver(storedValue) {
    return decryptToken(storedValue);
  },
});

/**
 * Renders `column = ANY (ARRAY['a'::text, ...])`, the exact text Postgres
 * stores for these CHECK constraints, so the constraint and the column's TS
 * union come from one value list.
 */
function isOneOf(column: string, values: readonly string[]) {
  return sql.raw(`${column} = ANY (ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}])`);
}

// Allowed values, one list per CHECK constraint

/** Platform ids a social account, connection or direct post can carry. */
export const SOCIAL_PLATFORMS = ["linkedin", "tiktok", "pinterest", "instagram", "facebook", "threads", "youtube", "x", "bluesky", "mastodon", "telegram", "discord", "slack", "devto", "wordpress", "reddit", "tumblr", "twitch", "kick", "hashnode", "medium", "lemmy", "farcaster", "listmonk", "nostr", "linkedin_page", "dribbble", "gmb"] as const;

/** Lifecycle of a scheduled post (failed_posts keeps the same list). */
export const POST_STATUSES = ["scheduled", "queued", "processing", "posted", "failed", "cancelled"] as const;

/** What a post publishes. */
export const MEDIA_TYPES = ["text", "image", "video"] as const;

/** Which surface created a post or history row. */
export const CREATED_VIA_CHANNELS = ["web", "mcp", "x402", "api"] as const;

/** Which surface started an OAuth connection. */
export const CONNECTION_INITIATED_VIA = ["web", "mcp", "api", "x402", "share_link"] as const;

/** Lifecycle of an OAuth connection attempt. */
export const CONNECTION_STATUSES = ["pending", "connected", "expired", "failed", "revoked"] as const;

/** Lifecycle of a post-now publish. */
export const DIRECT_POST_STATUSES = ["processing", "completed", "failed"] as const;

/** Lifecycle of a TikTok status poll. */
export const TIKTOK_PULL_STATUSES = ["pending", "completed", "failed"] as const;

/** Trust state of an MCP OAuth client. */
export const OAUTH_CLIENT_TRUST_LEVELS = ["unverified", "verified", "blocked"] as const;

/** Outcome of one MCP tool call. */
export const MCP_AUDIT_RESULT_STATUSES = ["ok", "error", "denied", "rate_limited", "quota_exceeded"] as const;

/** Who a principal is: a Clerk user or a paying wallet. */
export const PRINCIPAL_KINDS = ["clerk", "wallet"] as const;

/** Chains a wallet principal can pay from. */
export const WALLET_CHAINS = ["base", "base-sepolia", "polygon", "arbitrum", "solana", "solana-devnet", "celo", "arc"] as const;

/** Latest sanctions screening state of a wallet. */
export const SANCTIONS_STATUSES = ["unchecked", "clean", "sanctioned"] as const;

/** Result of one sanctions screening. */
export const SANCTIONS_RESULTS = ["clean", "sanctioned", "error"] as const;

/** Which surface an API key unlocks. */
export const API_KEY_KINDS = ["rest", "mcp", "wallet"] as const;

/** Lifecycle of an x402 charge. */
export const X402_CHARGE_STATUSES = ["pending", "settled", "failed", "refunded"] as const;

/** Outcome of one x402 endpoint call. */
export const X402_ACCESS_RESULT_STATUSES = ["ok", "402_required", "sanctioned", "rate_limited", "error"] as const;

/** How often an x402 action is billed. */
export const PRICING_RECURRENCES = ["one_time", "monthly"] as const;

/**
 * Outcome of one REST API call. client_error is any other 4xx (404 not
 * found, 409 conflict): the caller's request, not a server failure.
 */
export const REST_AUDIT_OUTCOMES = ["success", "validation_error", "auth_error", "rate_limited", "client_error", "internal_error"] as const;

/** Why an x402 payment needs a manual look. */
export const X402_RECONCILIATION_KINDS = ["settle_unrecorded", "settle_indeterminate", "refund_failed"] as const;

// Value unions of the lists above, for code that holds a column value
// (`platform: Platform`). Adding a value to a list updates its union. Row
// shapes come from the tables: `typeof scheduled_posts.$inferSelect`.
export type Platform = (typeof SOCIAL_PLATFORMS)[number];
export type PostStatus = (typeof POST_STATUSES)[number];
export type MediaType = (typeof MEDIA_TYPES)[number];
export type CreatedVia = (typeof CREATED_VIA_CHANNELS)[number];
export type TrustLevel = (typeof OAUTH_CLIENT_TRUST_LEVELS)[number];
export type WalletChain = (typeof WALLET_CHAINS)[number];
export type SanctionsStatus = (typeof SANCTIONS_STATUSES)[number];
export type PricingRecurrence = (typeof PRICING_RECURRENCES)[number];

export const referral_status = pgEnum("referral_status", ["pending", "verified", "redeemed", "void"]);

// Identity: principals, Clerk users, wallets, API keys

export const principals = pgTable("principals", {
  id: text().primaryKey(),
  kind: text({ enum: PRINCIPAL_KINDS }).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
  deleted_at: timestamptz(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
}, (table) => [
  index("idx_principals_kind_active").on(table.kind).where(sql`(deleted_at IS NULL)`),
  pgPolicy("principals_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("principals_kind_check", isOneOf("kind", PRINCIPAL_KINDS)),
]).enableRLS();

export const users = pgTable("users", {
  id: text().primaryKey(),
  email: citext().notNull(),
  first_name: text(),
  last_name: text(),
  stripe_customer_id: text().notNull(),
  locale: text(),
  timezone: text(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
  creator_access_until: timestamptz(),
}, (table) => [
  foreignKey({
    columns: [table.id],
    foreignColumns: [principals.id],
    name: "users_id_fkey",
  }).onDelete("cascade"),
  unique("users_email_key").on(table.email),
  unique("users_stripe_customer_id_key").on(table.stripe_customer_id),
  pgPolicy("users_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]).enableRLS();

export const wallets = pgTable("wallets", {
  id: text().primaryKey(),
  address: text().notNull(),
  chain: text({ enum: WALLET_CHAINS }).default("base").notNull(),
  display_name: text(),
  ens_name: text(),
  sanctions_status: text({ enum: SANCTIONS_STATUSES }).default("unchecked").notNull(),
  sanctions_checked_at: timestamptz(),
  registered_at: timestamptz().default(sql`now()`).notNull(),
  last_seen_at: timestamptz().default(sql`now()`).notNull(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
}, (table) => [
  index("idx_wallets_sanctions").on(table.sanctions_status).where(sql`(sanctions_status <> 'clean'::text)`),
  foreignKey({
    columns: [table.id],
    foreignColumns: [principals.id],
    name: "wallets_id_fkey",
  }).onDelete("restrict"),
  unique("wallets_address_key").on(table.address),
  pgPolicy("wallets_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("wallets_chain_check", isOneOf("chain", WALLET_CHAINS)),
  check("wallets_sanctions_status_check", isOneOf("sanctions_status", SANCTIONS_STATUSES)),
]).enableRLS();

export const api_keys = pgTable("api_keys", {
  id: uuid().defaultRandom().primaryKey(),
  principal_id: text().notNull(),
  name: text().notNull(),
  prefix: text().notNull(),
  token_hash: text().notNull(),
  kind: text({ enum: API_KEY_KINDS }).notNull(),
  scopes: text().array().default(sql`ARRAY['post.write'::text, 'account.read'::text, 'schedule.read'::text]`).notNull(),
  expires_at: timestamptz(),
  last_used_at: timestamptz(),
  last_used_ip: text(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  revoked_at: timestamptz(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
}, (table) => [
  index("idx_api_keys_kind_active").on(table.kind).where(sql`(revoked_at IS NULL)`),
  index("idx_api_keys_prefix").on(table.prefix).where(sql`(revoked_at IS NULL)`),
  index("idx_api_keys_principal_active").on(table.principal_id).where(sql`(revoked_at IS NULL)`),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "api_keys_principal_id_fkey",
  }).onDelete("cascade"),
  unique("api_keys_token_hash_key").on(table.token_hash),
  pgPolicy("api_keys_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("api_keys_kind_check", isOneOf("kind", API_KEY_KINDS)),
]).enableRLS();

// Social accounts and OAuth connections

// social_accounts and social_connections reference each other, so TypeScript needs the constraint list's type spelled out.
export const social_accounts = pgTable("social_accounts", {
  id: uuid().defaultRandom().primaryKey(),
  principal_id: text().notNull(),
  platform: text({ enum: SOCIAL_PLATFORMS }).notNull(),
  account_identifier: text().notNull(),
  display_name: text(),
  username: text(),
  email_address: citext(),
  avatar_url: text(),
  is_verified: boolean(),
  follower_count: bigint({ mode: "number" }),
  following_count: bigint({ mode: "number" }),
  bio_description: text(),
  is_available: boolean().default(true).notNull(),
  access_token: encryptedText(),
  refresh_token: encryptedText(),
  token_expires_at: timestamptz(),
  connection_id: text(),
  extra: jsonb().$type<Json>().default({}).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
  deleted_at: timestamptz(),
}, (table): PgTableExtraConfigValue[] => [
  index("idx_social_accounts_connection").on(table.connection_id).where(sql`(connection_id IS NOT NULL)`),
  index("idx_social_accounts_principal_active").on(table.principal_id).where(sql`((deleted_at IS NULL) AND (is_available = true))`),
  index("idx_social_accounts_token_expiry").on(table.token_expires_at).where(sql`((deleted_at IS NULL) AND (token_expires_at IS NOT NULL))`),
  foreignKey({
    columns: [table.connection_id],
    foreignColumns: [social_connections.id],
    name: "social_accounts_connection_fk",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "social_accounts_principal_id_fkey",
  }).onDelete("cascade"),
  unique("social_accounts_unique_per_principal").on(table.principal_id, table.platform, table.account_identifier),
  pgPolicy("social_accounts_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("social_accounts_platform_check", isOneOf("platform", SOCIAL_PLATFORMS)),
]).enableRLS();

// social_connections and social_accounts reference each other, so TypeScript needs the constraint list's type spelled out.
export const social_connections = pgTable("social_connections", {
  id: text().primaryKey(),
  principal_id: text().notNull(),
  initiated_via: text({ enum: CONNECTION_INITIATED_VIA }).notNull(),
  initiated_x402_charge_id: uuid(),
  platform: text({ enum: SOCIAL_PLATFORMS }).notNull(),
  oauth_state: text().notNull(),
  oauth_code_verifier: text(),
  redirect_uri: text().notNull(),
  status: text({ enum: CONNECTION_STATUSES }).default("pending").notNull(),
  expires_at: timestamptz().notNull(),
  connected_at: timestamptz(),
  failed_at: timestamptz(),
  error_code: text(),
  error_message: text(),
  social_account_id: uuid(),
  poll_count: integer().default(0).notNull(),
  last_polled_at: timestamptz(),
  last_polled_ip_hash: text(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
  share_link_id: uuid(),
}, (table): PgTableExtraConfigValue[] => [
  index("idx_social_connections_account").on(table.social_account_id).where(sql`(social_account_id IS NOT NULL)`),
  index("idx_social_connections_principal").on(table.principal_id, table.created_at.desc().nullsFirst()),
  index("idx_social_connections_status_expiry").on(table.status, table.expires_at).where(sql`(status = 'pending'::text)`),
  index("social_connections_share_link_idx").on(table.share_link_id).where(sql`(share_link_id IS NOT NULL)`),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "social_connections_principal_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.share_link_id],
    foreignColumns: [share_links.id],
    name: "social_connections_share_link_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.social_account_id],
    foreignColumns: [social_accounts.id],
    name: "social_connections_social_account_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.initiated_x402_charge_id],
    foreignColumns: [x402_charges.id],
    name: "social_connections_x402_charge_fk",
  }).onDelete("set null"),
  unique("social_connections_oauth_state_key").on(table.oauth_state),
  pgPolicy("social_connections_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("social_connections_initiated_via_check", isOneOf("initiated_via", CONNECTION_INITIATED_VIA)),
  check("social_connections_platform_check", isOneOf("platform", SOCIAL_PLATFORMS)),
  check("social_connections_status_check", isOneOf("status", CONNECTION_STATUSES)),
]).enableRLS();

export const share_links = pgTable("share_links", {
  id: uuid().defaultRandom().primaryKey(),
  owner_principal_id: text().notNull(),
  platform: text().notNull(),
  // Encrypted, so the owner can copy the link again; lookups use token_hash.
  token: encryptedText().notNull(),
  // SHA-256 hex of the token (hashToken in src/lib/api/tokens.ts).
  token_hash: text(),
  expires_at: timestamptz(),
  max_uses: integer(),
  used_count: integer().default(0).notNull(),
  revoked_at: timestamptz(),
  last_used_at: timestamptz(),
  created_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("share_links_active_idx").on(table.owner_principal_id, table.created_at.desc().nullsFirst()).where(sql`(revoked_at IS NULL)`),
  index("share_links_owner_idx").on(table.owner_principal_id),
  foreignKey({
    columns: [table.owner_principal_id],
    foreignColumns: [users.id],
    name: "share_links_owner_principal_id_fkey",
  }).onDelete("cascade"),
  unique("share_links_token_key").on(table.token),
  unique("share_links_token_hash_key").on(table.token_hash),
  check("share_links_max_uses_positive", sql`(max_uses IS NULL) OR (max_uses > 0)`),
  check("share_links_used_count_nonneg", sql`used_count >= 0`),
]).enableRLS();

// Posting: schedule, publish, history, analytics

// scheduled_posts and x402_charges reference each other, so TypeScript needs the constraint list's type spelled out.
export const scheduled_posts = pgTable("scheduled_posts", {
  id: uuid().defaultRandom().primaryKey(),
  principal_id: text().notNull(),
  social_account_id: uuid().notNull(),
  platform: text().notNull(),
  status: text({ enum: POST_STATUSES }).default("scheduled").notNull(),
  scheduled_at: timestamptz().notNull(),
  posted_at: timestamptz(),
  scheduled_at_date: date().generatedAlwaysAs(sql`((scheduled_at AT TIME ZONE 'UTC'::text))::date`),
  post_title: text(),
  post_description: text(),
  post_options: jsonb().$type<Json>().default({}).notNull(),
  media_type: text({ enum: MEDIA_TYPES }).notNull(),
  media_storage_path: text().default("").notNull(),
  cover_image_timestamp: numeric({ mode: "number" }),
  batch_id: text(),
  error_message: text(),
  retry_count: integer().default(0).notNull(),
  created_via: text({ enum: CREATED_VIA_CHANNELS }).default("web").notNull(),
  idempotency_key: text(),
  x402_charge_id: uuid(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
  cancelled_by_sub_at: timestamptz(),
}, (table): PgTableExtraConfigValue[] => [
  index("idx_scheduled_posts_batch").on(table.batch_id).where(sql`(batch_id IS NOT NULL)`),
  index("idx_scheduled_posts_cancelled_by_sub_at").on(table.cancelled_by_sub_at).where(sql`(cancelled_by_sub_at IS NOT NULL)`),
  index("idx_scheduled_posts_media_storage_path_active").on(table.media_storage_path).where(sql`(status = ANY (ARRAY['scheduled'::text, 'processing'::text]))`),
  index("idx_scheduled_posts_principal_platform_window").on(table.principal_id, table.platform, table.scheduled_at).where(sql`(status = ANY (ARRAY['scheduled'::text, 'queued'::text, 'processing'::text]))`),
  index("idx_scheduled_posts_principal_recent").on(table.principal_id, table.created_at.desc().nullsFirst()),
  index("idx_scheduled_posts_status_due").on(table.status, table.scheduled_at).where(sql`(status = ANY (ARRAY['scheduled'::text, 'queued'::text, 'processing'::text]))`),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "scheduled_posts_principal_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.social_account_id],
    foreignColumns: [social_accounts.id],
    name: "scheduled_posts_social_account_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.x402_charge_id],
    foreignColumns: [x402_charges.id],
    name: "scheduled_posts_x402_charge_fk",
  }).onDelete("set null"),
  unique("scheduled_posts_principal_idem_uq").on(table.principal_id, table.idempotency_key),
  pgPolicy("scheduled_posts_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("scheduled_posts_created_via_check", isOneOf("created_via", CREATED_VIA_CHANNELS)),
  check("scheduled_posts_media_type_check", isOneOf("media_type", MEDIA_TYPES)),
  check("scheduled_posts_status_check", isOneOf("status", POST_STATUSES)),
]).enableRLS();

export const failed_posts = pgTable("failed_posts", {
  id: uuid().defaultRandom().primaryKey(),
  principal_id: text().notNull(),
  social_account_id: uuid().notNull(),
  platform: text().notNull(),
  status: text({ enum: POST_STATUSES }).default("failed").notNull(),
  scheduled_at: timestamptz().notNull(),
  posted_at: timestamptz(),
  scheduled_at_date: date().generatedAlwaysAs(sql`((scheduled_at AT TIME ZONE 'UTC'::text))::date`),
  post_title: text(),
  post_description: text(),
  post_options: jsonb().$type<Json>().default({}).notNull(),
  media_type: text({ enum: MEDIA_TYPES }).notNull(),
  media_storage_path: text().default("").notNull(),
  cover_image_timestamp: numeric({ mode: "number" }),
  batch_id: text(),
  error_message: text(),
  retry_count: integer().default(0).notNull(),
  created_via: text({ enum: CREATED_VIA_CHANNELS }).default("web").notNull(),
  idempotency_key: text(),
  x402_charge_id: uuid(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("failed_posts_batch_id_idx").on(table.batch_id).where(sql`(batch_id IS NOT NULL)`),
  index("failed_posts_principal_id_created_at_idx").on(table.principal_id, table.created_at.desc().nullsFirst()),
  uniqueIndex("failed_posts_principal_id_idempotency_key_idx").on(table.principal_id, table.idempotency_key).where(sql`(idempotency_key IS NOT NULL)`),
  index("failed_posts_principal_id_platform_scheduled_at_idx").on(table.principal_id, table.platform, table.scheduled_at).where(sql`(status = ANY (ARRAY['scheduled'::text, 'processing'::text]))`),
  index("failed_posts_status_scheduled_at_idx").on(table.status, table.scheduled_at).where(sql`(status = ANY (ARRAY['scheduled'::text, 'processing'::text]))`),
  index("idx_failed_posts_media_storage_path").on(table.media_storage_path),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "failed_posts_principal_id_fkey",
  }).onDelete("cascade"),
  pgPolicy("failed_posts_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("failed_posts_status_check", isOneOf("status", POST_STATUSES)),
  check("scheduled_posts_created_via_check", isOneOf("created_via", CREATED_VIA_CHANNELS)),
  check("scheduled_posts_media_type_check", isOneOf("media_type", MEDIA_TYPES)),
]).enableRLS();

export const pending_direct_posts = pgTable("pending_direct_posts", {
  event_id: text().primaryKey(),
  batch_id: text().notNull(),
  principal_id: text().notNull(),
  social_account_id: uuid().notNull(),
  platform: text({ enum: SOCIAL_PLATFORMS }).notNull(),
  media_storage_path: text().notNull(),
  status: text({ enum: DIRECT_POST_STATUSES }).default("processing").notNull(),
  failure_reason: text(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  finished_at: timestamptz(),
  idempotency_key: text(),
}, (table) => [
  index("idx_pending_direct_posts_batch").on(table.batch_id),
  index("idx_pending_direct_posts_path_status").on(table.media_storage_path, table.status).where(sql`(status = 'processing'::text)`),
  index("idx_pending_direct_posts_processing_age").on(table.status, table.created_at).where(sql`(status = 'processing'::text)`),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "pending_direct_posts_principal_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.social_account_id],
    foreignColumns: [social_accounts.id],
    name: "pending_direct_posts_social_account_id_fkey",
  }).onDelete("cascade"),
  unique("pending_direct_posts_principal_idem_uq").on(table.principal_id, table.idempotency_key),
  check("pending_direct_posts_platform_check", isOneOf("platform", SOCIAL_PLATFORMS)),
  check("pending_direct_posts_status_check", isOneOf("status", DIRECT_POST_STATUSES)),
]).enableRLS();

export const pending_tiktok_pulls = pgTable("pending_tiktok_pulls", {
  publish_id: text().primaryKey(),
  principal_id: text().notNull(),
  social_account_id: uuid().notNull(),
  scheduled_post_id: uuid(),
  content_history_id: uuid(),
  media_storage_path: text().notNull(),
  status: text({ enum: TIKTOK_PULL_STATUSES }).default("pending").notNull(),
  attempt_count: integer().default(0).notNull(),
  last_polled_at: timestamptz(),
  finalized_at: timestamptz(),
  failure_reason: text(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  tiktok_post_id: text(),
  creator_username: text(),
}, (table) => [
  index("idx_pending_tiktok_pulls_path_status").on(table.media_storage_path, table.status).where(sql`(status = 'pending'::text)`),
  index("idx_pending_tiktok_pulls_pending_age").on(table.status, table.created_at).where(sql`(status = 'pending'::text)`),
  foreignKey({
    columns: [table.content_history_id],
    foreignColumns: [content_history.id],
    name: "pending_tiktok_pulls_content_history_id_fkey",
  }),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "pending_tiktok_pulls_principal_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.scheduled_post_id],
    foreignColumns: [scheduled_posts.id],
    name: "pending_tiktok_pulls_scheduled_post_id_fkey",
  }),
  foreignKey({
    columns: [table.social_account_id],
    foreignColumns: [social_accounts.id],
    name: "pending_tiktok_pulls_social_account_id_fkey",
  }).onDelete("cascade"),
  check("pending_tiktok_pulls_status_check", isOneOf("status", TIKTOK_PULL_STATUSES)),
]).enableRLS();

export const content_history = pgTable("content_history", {
  id: uuid().defaultRandom().primaryKey(),
  principal_id: text().notNull(),
  social_account_id: uuid(),
  scheduled_post_id: uuid(),
  platform: text().notNull(),
  content_id: text().notNull(),
  title: text(),
  description: text(),
  media_url: text(),
  media_type: text(),
  status: text(),
  batch_id: text(),
  created_via: text({ enum: CREATED_VIA_CHANNELS }).default("web").notNull(),
  extra: jsonb().$type<Json>().default({}).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("idx_content_history_batch").on(table.batch_id).where(sql`(batch_id IS NOT NULL)`),
  index("idx_content_history_principal_time").on(table.principal_id, table.created_at.desc().nullsFirst()),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "content_history_principal_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.scheduled_post_id],
    foreignColumns: [scheduled_posts.id],
    name: "content_history_scheduled_post_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.social_account_id],
    foreignColumns: [social_accounts.id],
    name: "content_history_social_account_id_fkey",
  }).onDelete("set null"),
  pgPolicy("content_history_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("content_history_created_via_check", isOneOf("created_via", CREATED_VIA_CHANNELS)),
]).enableRLS();

export const analytics_metrics = pgTable("analytics_metrics", {
  id: uuid().defaultRandom().primaryKey(),
  principal_id: text(),
  platform: text().notNull(),
  content_id: text(),
  metric_date: date().default(sql`CURRENT_DATE`).notNull(),
  views: bigint({ mode: "number" }).default(0).notNull(),
  comments: bigint({ mode: "number" }).default(0).notNull(),
  likes: bigint({ mode: "number" }).default(0).notNull(),
  shares: bigint({ mode: "number" }).default(0).notNull(),
  subscribers: bigint({ mode: "number" }).default(0).notNull(),
  extra: jsonb().$type<Json>().default({}).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("idx_analytics_principal_platform_date").on(table.principal_id, table.platform, table.metric_date.desc().nullsFirst()),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "analytics_metrics_principal_id_fkey",
  }).onDelete("cascade"),
  unique("analytics_unique_daily").on(table.principal_id, table.platform, table.content_id, table.metric_date),
  pgPolicy("analytics_metrics_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]).enableRLS();

export const tiktok_webhook_events = pgTable("tiktok_webhook_events", {
  event_id: text().primaryKey(),
  event_type: text().notNull(),
  processed_at: timestamptz().default(sql`now()`).notNull(),
}).enableRLS();

// Billing: Stripe, quotas, referrals

export const stripe_subscriptions = pgTable("stripe_subscriptions", {
  id: uuid().defaultRandom().primaryKey(),
  user_id: text().notNull(),
  stripe_subscription_id: text().notNull(),
  stripe_customer_id: text().notNull(),
  stripe_price_id: text(),
  plan: text(),
  status: text().notNull(),
  start_date: timestamptz().notNull(),
  end_date: timestamptz(),
  current_period_end: timestamptz(),
  cancel_reason: text(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("idx_stripe_subs_user_active").on(table.user_id).where(sql`(status = ANY (ARRAY['active'::text, 'trialing'::text]))`),
  foreignKey({
    columns: [table.user_id],
    foreignColumns: [users.id],
    name: "stripe_subscriptions_user_id_fkey",
  }).onDelete("cascade"),
  unique("stripe_subscriptions_stripe_subscription_id_key").on(table.stripe_subscription_id),
  pgPolicy("stripe_subscriptions_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]).enableRLS();

export const stripe_invoices = pgTable("stripe_invoices", {
  id: uuid().defaultRandom().primaryKey(),
  // Null once the user is deleted: the invoice record outlives the account.
  user_id: text(),
  stripe_invoice_id: text(),
  amount_paid_cents: integer(),
  currency: text(),
  status: text(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  foreignKey({
    columns: [table.user_id],
    foreignColumns: [users.id],
    name: "stripe_invoices_user_id_fkey",
  }).onDelete("set null"),
  unique("stripe_invoices_stripe_invoice_id_key").on(table.stripe_invoice_id),
  pgPolicy("stripe_invoices_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]).enableRLS();

export const stripe_webhook_events = pgTable("stripe_webhook_events", {
  event_id: text().primaryKey(),
  type: text().notNull(),
  processed_at: timestamptz().default(sql`now()`).notNull(),
  livemode: boolean().default(false).notNull(),
}, (table) => [
  index("idx_stripe_webhook_events_processed_at").on(table.processed_at.desc().nullsFirst()),
]).enableRLS();

export const usage_quotas = pgTable("usage_quotas", {
  principal_id: text().notNull(),
  period: date().notNull(),
  action: text().notNull(),
  count: integer().default(0).notNull(),
}, (table) => [
  index("idx_usage_quotas_period").on(table.period),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "usage_quotas_principal_id_fkey",
  }).onDelete("cascade"),
  primaryKey({ columns: [table.principal_id, table.period, table.action], name: "usage_quotas_pkey" }),
  pgPolicy("usage_quotas_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]).enableRLS();

export const platform_quotas = pgTable("platform_quotas", {
  platform: text().primaryKey(),
  daily_cap: integer().notNull(),
  burst_cap_60s: integer().notNull(),
  notes: text(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  pgPolicy("platform_quotas_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]).enableRLS();

export const referral_codes = pgTable("referral_codes", {
  user_id: text().primaryKey(),
  code: text().notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  foreignKey({
    columns: [table.user_id],
    foreignColumns: [users.id],
    name: "referral_codes_user_id_fkey",
  }).onDelete("cascade"),
  unique("referral_codes_code_key").on(table.code),
]).enableRLS();

export const referrals = pgTable("referrals", {
  id: uuid().defaultRandom().primaryKey(),
  referrer_id: text().notNull(),
  referred_id: text().notNull(),
  status: referral_status().default("pending").notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  verified_at: timestamptz(),
  redeemed_at: timestamptz(),
  reward_batch_id: uuid(),
}, (table) => [
  index("referrals_referrer_status_idx").on(table.referrer_id, table.status),
  foreignKey({
    columns: [table.referred_id],
    foreignColumns: [users.id],
    name: "referrals_referred_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.referrer_id],
    foreignColumns: [users.id],
    name: "referrals_referrer_id_fkey",
  }).onDelete("cascade"),
  unique("referrals_referred_unique").on(table.referred_id),
  check("referrals_no_self", sql`referrer_id <> referred_id`),
]).enableRLS();

export const referral_reward_grants = pgTable("referral_reward_grants", {
  id: uuid().defaultRandom().primaryKey(),
  user_id: text().notNull(),
  weeks_granted: integer().default(1).notNull(),
  granted_at: timestamptz().default(sql`now()`).notNull(),
  creator_access_until_before: timestamptz(),
  creator_access_until_after: timestamptz().notNull(),
  referral_ids: uuid().array().notNull(),
}, (table) => [
  index("referral_reward_grants_user_idx").on(table.user_id),
  foreignKey({
    columns: [table.user_id],
    foreignColumns: [users.id],
    name: "referral_reward_grants_user_id_fkey",
  }).onDelete("cascade"),
]).enableRLS();

// x402 pay-per-call

export const pricing_actions = pgTable("pricing_actions", {
  action: text().primaryKey(),
  display_name: text().notNull(),
  usdc_price: numeric({ precision: 18, scale: 6, mode: "number" }).notNull(),
  description: text(),
  recurrence: text({ enum: PRICING_RECURRENCES }).default("one_time").notNull(),
  effective_from: timestamptz().default(sql`now()`).notNull(),
  effective_until: timestamptz(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  pgPolicy("pricing_actions_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("pricing_actions_recurrence_check", isOneOf("recurrence", PRICING_RECURRENCES)),
  check("pricing_actions_usdc_price_check", sql`usdc_price >= (0)::numeric`),
]).enableRLS();

// x402_charges and scheduled_posts reference each other, so TypeScript needs the constraint list's type spelled out.
export const x402_charges = pgTable("x402_charges", {
  id: uuid().defaultRandom().primaryKey(),
  principal_id: text().notNull(),
  wallet_id: text().notNull(),
  action: text().notNull(),
  amount_usdc: numeric({ precision: 18, scale: 6, mode: "number" }).notNull(),
  amount_usd_at_receipt: numeric({ precision: 18, scale: 6, mode: "number" }),
  network: text().default("base").notNull(),
  asset: text().default("USDC").notNull(),
  nonce: text().notNull(),
  request_id: text(),
  payer_address: text().notNull(),
  recipient_address: text().notNull(),
  status: text({ enum: X402_CHARGE_STATUSES }).default("pending").notNull(),
  facilitator: text().default("coinbase").notNull(),
  facilitator_fee_usdc: numeric({ precision: 18, scale: 6, mode: "number" }),
  tx_hash: text(),
  block_number: bigint({ mode: "number" }),
  scheduled_post_id: uuid(),
  social_connection_id: text(),
  error_message: text(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  settled_at: timestamptz(),
}, (table): PgTableExtraConfigValue[] => [
  index("idx_x402_pending_aged").on(table.created_at).where(sql`(status = 'pending'::text)`),
  index("idx_x402_principal_time").on(table.principal_id, table.created_at.desc().nullsFirst()),
  index("idx_x402_settled_at").on(table.settled_at).where(sql`(status = 'settled'::text)`),
  index("x402_charges_payer_address_idx").on(table.payer_address),
  foreignKey({
    columns: [table.action],
    foreignColumns: [pricing_actions.action],
    name: "x402_charges_action_fkey",
  }),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "x402_charges_principal_id_fkey",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.scheduled_post_id],
    foreignColumns: [scheduled_posts.id],
    name: "x402_charges_scheduled_post_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.social_connection_id],
    foreignColumns: [social_connections.id],
    name: "x402_charges_social_connection_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.wallet_id],
    foreignColumns: [wallets.id],
    name: "x402_charges_wallet_id_fkey",
  }).onDelete("restrict"),
  unique("x402_charges_nonce_key").on(table.nonce),
  unique("x402_charges_request_id_key").on(table.request_id),
  pgPolicy("x402_charges_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("x402_charges_amount_usdc_check", sql`amount_usdc > (0)::numeric`),
  check("x402_charges_status_check", isOneOf("status", X402_CHARGE_STATUSES)),
]).enableRLS();

export const x402_refunds = pgTable("x402_refunds", {
  id: uuid().defaultRandom().primaryKey(),
  charge_id: uuid().notNull(),
  reason: text().notNull(),
  refunded_usdc: numeric({ precision: 18, scale: 6, mode: "number" }).notNull(),
  refund_tx_hash: text(),
  initiated_by: text(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("idx_refunds_charge").on(table.charge_id),
  foreignKey({
    columns: [table.charge_id],
    foreignColumns: [x402_charges.id],
    name: "x402_refunds_charge_id_fkey",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.initiated_by],
    foreignColumns: [principals.id],
    name: "x402_refunds_initiated_by_fkey",
  }).onDelete("set null"),
  pgPolicy("x402_refunds_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("x402_refunds_refunded_usdc_check", sql`refunded_usdc > (0)::numeric`),
]).enableRLS();

export const x402_reconciliation = pgTable("x402_reconciliation", {
  id: uuid().defaultRandom().primaryKey(),
  charge_id: uuid(),
  tx_hash: text(),
  kind: text({ enum: X402_RECONCILIATION_KINDS }).notNull(),
  payer_address: text(),
  amount_atomic: text(),
  network: text(),
  created_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  check("x402_reconciliation_kind_check", isOneOf("kind", X402_RECONCILIATION_KINDS)),
]).enableRLS();

export const x402_access_log = pgTable("x402_access_log", {
  id: bigserial({ mode: "number" }).primaryKey(),
  principal_id: text(),
  wallet_id: text(),
  endpoint: text().notNull(),
  action: text(),
  charge_id: uuid(),
  result_status: text({ enum: X402_ACCESS_RESULT_STATUSES }).notNull(),
  latency_ms: integer(),
  ip_hash: text(),
  user_agent: text(),
  month: date().generatedAlwaysAs(sql`(date_trunc('month'::text, (created_at AT TIME ZONE 'UTC'::text)))::date`),
  created_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("idx_x402_log_month").on(table.month),
  index("idx_x402_log_wallet_time").on(table.wallet_id, table.created_at.desc().nullsFirst()),
  foreignKey({
    columns: [table.action],
    foreignColumns: [pricing_actions.action],
    name: "x402_access_log_action_fkey",
  }),
  foreignKey({
    columns: [table.charge_id],
    foreignColumns: [x402_charges.id],
    name: "x402_access_log_charge_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "x402_access_log_principal_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.wallet_id],
    foreignColumns: [wallets.id],
    name: "x402_access_log_wallet_id_fkey",
  }).onDelete("set null"),
  pgPolicy("x402_access_log_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("x402_access_log_result_status_check", isOneOf("result_status", X402_ACCESS_RESULT_STATUSES)),
]).enableRLS();

export const wallet_credits = pgTable("wallet_credits", {
  wallet_id: text().primaryKey(),
  balance_usdc: numeric({ precision: 18, scale: 6, mode: "number" }).default(sql`'0'`).notNull(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  foreignKey({
    columns: [table.wallet_id],
    foreignColumns: [wallets.id],
    name: "wallet_credits_wallet_id_fkey",
  }).onDelete("cascade"),
  pgPolicy("wallet_credits_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("wallet_credits_balance_usdc_check", sql`balance_usdc >= (0)::numeric`),
]).enableRLS();

export const sanctions_screenings = pgTable("sanctions_screenings", {
  id: bigserial({ mode: "number" }).primaryKey(),
  wallet_id: text().notNull(),
  result: text({ enum: SANCTIONS_RESULTS }).notNull(),
  source: text().notNull(),
  raw_response: jsonb().$type<Json>(),
  checked_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("idx_sanctions_wallet_time").on(table.wallet_id, table.checked_at.desc().nullsFirst()),
  foreignKey({
    columns: [table.wallet_id],
    foreignColumns: [wallets.id],
    name: "sanctions_screenings_wallet_id_fkey",
  }).onDelete("cascade"),
  pgPolicy("sanctions_screenings_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("sanctions_screenings_result_check", isOneOf("result", SANCTIONS_RESULTS)),
]).enableRLS();

// MCP, REST API and webhooks

export const mcp_oauth_clients = pgTable("mcp_oauth_clients", {
  client_id: text().primaryKey(),
  client_name: text().notNull(),
  redirect_uris: text().array().notNull(),
  software_id: text(),
  software_version: text(),
  registered_by_user_id: text(),
  trust_level: text({ enum: OAUTH_CLIENT_TRUST_LEVELS }).default("unverified").notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  revoked_at: timestamptz(),
  metadata: jsonb().$type<Json>().default({}).notNull(),
}, (table) => [
  index("idx_mcp_oauth_clients_trust").on(table.trust_level).where(sql`(revoked_at IS NULL)`),
  foreignKey({
    columns: [table.registered_by_user_id],
    foreignColumns: [users.id],
    name: "mcp_oauth_clients_registered_by_user_id_fkey",
  }).onDelete("set null"),
  pgPolicy("mcp_oauth_clients_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("mcp_oauth_clients_trust_level_check", isOneOf("trust_level", OAUTH_CLIENT_TRUST_LEVELS)),
]).enableRLS();

export const mcp_audit_log = pgTable("mcp_audit_log", {
  id: bigserial({ mode: "number" }).primaryKey(),
  principal_id: text(),
  oauth_client_id: text(),
  api_key_id: uuid(),
  session_id: text(),
  tool_name: text().notNull(),
  args_redacted: jsonb().$type<Json>(),
  result_status: text({ enum: MCP_AUDIT_RESULT_STATUSES }).notNull(),
  latency_ms: integer(),
  ip_hash: text(),
  user_agent: text(),
  month: date().generatedAlwaysAs(sql`(date_trunc('month'::text, (created_at AT TIME ZONE 'UTC'::text)))::date`),
  created_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("idx_audit_month").on(table.month),
  index("idx_audit_principal_time").on(table.principal_id, table.created_at.desc().nullsFirst()),
  index("idx_audit_tool_time").on(table.tool_name, table.created_at.desc().nullsFirst()),
  foreignKey({
    columns: [table.api_key_id],
    foreignColumns: [api_keys.id],
    name: "mcp_audit_log_api_key_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.oauth_client_id],
    foreignColumns: [mcp_oauth_clients.client_id],
    name: "mcp_audit_log_oauth_client_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "mcp_audit_log_principal_id_fkey",
  }).onDelete("set null"),
  pgPolicy("mcp_audit_log_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
  check("mcp_audit_log_result_status_check", isOneOf("result_status", MCP_AUDIT_RESULT_STATUSES)),
]).enableRLS();

export const rest_audit_log = pgTable("rest_audit_log", {
  id: uuid().defaultRandom().primaryKey(),
  principal_id: text().notNull(),
  api_key_id: uuid(),
  endpoint: text().notNull(),
  http_method: text().notNull(),
  request_id: text().notNull(),
  ip_hash: text(),
  user_agent: text(),
  status_code: integer().notNull(),
  outcome: text({ enum: REST_AUDIT_OUTCOMES }).notNull(),
  error_code: text(),
  latency_ms: integer(),
  args_redacted: jsonb().$type<Json>(),
  response_summary: jsonb().$type<Json>(),
  created_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("rest_audit_log_principal_created_idx").on(table.principal_id, table.created_at.desc().nullsFirst()),
  index("rest_audit_log_request_id_idx").on(table.request_id),
  foreignKey({
    columns: [table.api_key_id],
    foreignColumns: [api_keys.id],
    name: "rest_audit_log_api_key_id_fkey",
  }).onDelete("set null"),
  check("rest_audit_log_outcome_check", isOneOf("outcome", REST_AUDIT_OUTCOMES)),
]).enableRLS();

export const rate_limit_events = pgTable("rate_limit_events", {
  id: bigserial({ mode: "number" }).primaryKey(),
  principal_id: text(),
  ip_hash: text(),
  scope: text().notNull(),
  created_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("idx_rl_events_principal_time").on(table.principal_id, table.created_at.desc().nullsFirst()).where(sql`(principal_id IS NOT NULL)`),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "rate_limit_events_principal_id_fkey",
  }).onDelete("set null"),
  pgPolicy("rate_limit_events_svc", { for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]).enableRLS();

export const webhook_subscriptions = pgTable("webhook_subscriptions", {
  id: uuid().defaultRandom().primaryKey(),
  principal_id: text().notNull(),
  url: text().notNull(),
  events: text().array().notNull(),
  // Encrypted at rest; decrypted on read to sign each delivery.
  secret: encryptedText().notNull(),
  active: boolean().default(true).notNull(),
  failure_count: integer().default(0).notNull(),
  last_delivery_at: timestamptz(),
  last_disabled_at: timestamptz(),
  created_at: timestamptz().default(sql`now()`).notNull(),
  updated_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("webhook_subscriptions_events_gin_idx").using("gin", table.events).where(sql`(active = true)`),
  index("webhook_subscriptions_principal_active_idx").on(table.principal_id, table.active).where(sql`(active = true)`),
  foreignKey({
    columns: [table.principal_id],
    foreignColumns: [principals.id],
    name: "webhook_subscriptions_principal_id_fkey",
  }).onDelete("cascade"),
  check("webhook_subscriptions_url_check", sql`url ~ '^https://'::text`),
]).enableRLS();

export const webhook_deliveries = pgTable("webhook_deliveries", {
  id: uuid().defaultRandom().primaryKey(),
  subscription_id: uuid().notNull(),
  event_type: text().notNull(),
  event_id: text().notNull(),
  payload: jsonb().$type<Json>().notNull(),
  status_code: integer(),
  response_body: text(),
  attempt: integer().default(1).notNull(),
  latency_ms: integer(),
  delivered_at: timestamptz(),
  failed_at: timestamptz(),
  error_message: text(),
  created_at: timestamptz().default(sql`now()`).notNull(),
}, (table) => [
  index("webhook_deliveries_event_id_idx").on(table.event_id),
  index("webhook_deliveries_subscription_created_idx").on(table.subscription_id, table.created_at.desc().nullsFirst()),
  foreignKey({
    columns: [table.subscription_id],
    foreignColumns: [webhook_subscriptions.id],
    name: "webhook_deliveries_subscription_id_fkey",
  }).onDelete("cascade"),
]).enableRLS();
