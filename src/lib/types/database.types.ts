/**
 * Sharetopus database types for app code.
 *
 * Every live table's Row and Insert shape comes from the Drizzle schema
 * (src/db/schema.ts, the source of truth, verified against the live
 * database), so these types follow the tables instead of drifting from
 * them. Only the teams and channel-group blocks are written by hand: those
 * tables are not in the database yet (docs/DB_CHANGES_TEAMS.md,
 * docs/DB_CHANGES_GROUPS.md, docs/ROADMAP.md item 6).
 *
 * Never regenerate this file with `supabase gen types`. A column change
 * goes into src/db/schema.ts and shows up here on its own.
 */
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import type * as schema from "@/db/schema";

export type { Json } from "@/db/schema";

/**
 * One live table in the shape supabase-js and the Tables helpers expect.
 * Relationships stay empty: no query goes through the typed supabase-js
 * client anymore (database access is Drizzle, supabase-js is Storage only).
 */
type SchemaTable<Table extends PgTable> = {
  Row: InferSelectModel<Table>;
  Insert: InferInsertModel<Table>;
  Update: Partial<InferInsertModel<Table>>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      // Teams. Hand-added to match docs/DB_CHANGES_TEAMS.md; this file is
      // never regenerated, so these three blocks are edited by hand along
      // with the SQL.
      teams: {
        Row: {
          id: string;
          name: string;
          owner_principal_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          owner_principal_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          owner_principal_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teams_owner_principal_id_fkey";
            columns: ["owner_principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };
      team_members: {
        Row: {
          id: string;
          team_id: string;
          principal_id: string;
          role: "owner" | "admin" | "member";
          joined_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          principal_id: string;
          role: "owner" | "admin" | "member";
          joined_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          principal_id?: string;
          role?: "owner" | "admin" | "member";
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_members_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };
      team_invites: {
        Row: {
          id: string;
          team_id: string;
          email: string;
          role: "admin" | "member";
          token_hash: string;
          invited_by_principal_id: string;
          expires_at: string;
          accepted_at: string | null;
          accepted_by_principal_id: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          email: string;
          role: "admin" | "member";
          token_hash: string;
          invited_by_principal_id: string;
          expires_at: string;
          accepted_at?: string | null;
          accepted_by_principal_id?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          email?: string;
          role?: "admin" | "member";
          token_hash?: string;
          invited_by_principal_id?: string;
          expires_at?: string;
          accepted_at?: string | null;
          accepted_by_principal_id?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_invites_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      // Channel groups. Hand-added to match docs/DB_CHANGES_GROUPS.md.
      channel_groups: {
        Row: {
          id: string;
          principal_id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          principal_id: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          principal_id?: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "channel_groups_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };
      channel_group_members: {
        Row: {
          id: string;
          group_id: string;
          social_account_id: string;
          added_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          social_account_id: string;
          added_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          social_account_id?: string;
          added_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "channel_group_members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "channel_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "channel_group_members_social_account_id_fkey";
            columns: ["social_account_id"];
            isOneToOne: true;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      analytics_metrics: SchemaTable<typeof schema.analytics_metrics>;
      api_keys: SchemaTable<typeof schema.api_keys>;
      content_history: SchemaTable<typeof schema.content_history>;
      failed_posts: SchemaTable<typeof schema.failed_posts>;
      mcp_audit_log: SchemaTable<typeof schema.mcp_audit_log>;
      mcp_oauth_clients: SchemaTable<typeof schema.mcp_oauth_clients>;
      pending_direct_posts: SchemaTable<typeof schema.pending_direct_posts>;
      pending_tiktok_pulls: SchemaTable<typeof schema.pending_tiktok_pulls>;
      platform_quotas: SchemaTable<typeof schema.platform_quotas>;
      pricing_actions: SchemaTable<typeof schema.pricing_actions>;
      principals: SchemaTable<typeof schema.principals>;
      rate_limit_events: SchemaTable<typeof schema.rate_limit_events>;
      referral_codes: SchemaTable<typeof schema.referral_codes>;
      referral_reward_grants: SchemaTable<typeof schema.referral_reward_grants>;
      referrals: SchemaTable<typeof schema.referrals>;
      rest_audit_log: SchemaTable<typeof schema.rest_audit_log>;
      sanctions_screenings: SchemaTable<typeof schema.sanctions_screenings>;
      scheduled_posts: SchemaTable<typeof schema.scheduled_posts>;
      share_links: SchemaTable<typeof schema.share_links>;
      social_accounts: SchemaTable<typeof schema.social_accounts>;
      social_connections: SchemaTable<typeof schema.social_connections>;
      stripe_invoices: SchemaTable<typeof schema.stripe_invoices>;
      stripe_subscriptions: SchemaTable<typeof schema.stripe_subscriptions>;
      stripe_webhook_events: SchemaTable<typeof schema.stripe_webhook_events>;
      tiktok_webhook_events: SchemaTable<typeof schema.tiktok_webhook_events>;
      usage_quotas: SchemaTable<typeof schema.usage_quotas>;
      usdc_fmv_daily: SchemaTable<typeof schema.usdc_fmv_daily>;
      users: SchemaTable<typeof schema.users>;
      wallet_credits: SchemaTable<typeof schema.wallet_credits>;
      wallet_credits_ledger: SchemaTable<typeof schema.wallet_credits_ledger>;
      wallets: SchemaTable<typeof schema.wallets>;
      webhook_deliveries: SchemaTable<typeof schema.webhook_deliveries>;
      webhook_subscriptions: SchemaTable<typeof schema.webhook_subscriptions>;
      x402_access_log: SchemaTable<typeof schema.x402_access_log>;
      x402_charges: SchemaTable<typeof schema.x402_charges>;
      x402_reconciliation: SchemaTable<typeof schema.x402_reconciliation>;
      x402_refunds: SchemaTable<typeof schema.x402_refunds>;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type TableName = keyof Database["public"]["Tables"];

/** Row shape of a table: `Tables<"scheduled_posts">`. */
export type Tables<Name extends TableName> = Database["public"]["Tables"][Name]["Row"];

/** Insert shape of a table: `TablesInsert<"content_history">`. */
export type TablesInsert<Name extends TableName> =
  Database["public"]["Tables"][Name]["Insert"];

// Value unions of the CHECK-constrained text columns, derived from the
// schema value lists so a new value only needs adding in one place.
// sourceRef: src/db/schema.ts

export type WalletChain = (typeof schema.WALLET_CHAINS)[number];
export type SanctionsStatus = (typeof schema.SANCTIONS_STATUSES)[number];
export type TrustLevel = (typeof schema.OAUTH_CLIENT_TRUST_LEVELS)[number];
export type Platform = (typeof schema.SOCIAL_PLATFORMS)[number];
export type PostStatus = (typeof schema.POST_STATUSES)[number];
export type MediaType = (typeof schema.MEDIA_TYPES)[number];
export type CreatedVia = (typeof schema.CREATED_VIA_CHANNELS)[number];
export type PricingRecurrence = (typeof schema.PRICING_RECURRENCES)[number];

// Row aliases for the most-touched tables: `const post: ScheduledPost = ...`

export type ShareLink = Tables<"share_links">;
export type SocialAccount = Tables<"social_accounts">;
export type ScheduledPost = Tables<"scheduled_posts">;
export type ContentHistory = Tables<"content_history">;
