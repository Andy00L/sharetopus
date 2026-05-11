/**
 * Sharetopus DB types. Mirrors the schema in supabase/migrations/.
 *
 * Generated to match what `supabase gen types typescript` produces.
 * After you wire up the Supabase CLI, regenerate with:
 *   supabase gen types typescript --linked > src/lib/types/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      // ────────────────────────────────────────────────────────────────
      analytics_metrics: {
        Row: {
          id: string;
          principal_id: string;
          platform: string;
          content_id: string | null;
          metric_date: string;
          views: number;
          comments: number;
          likes: number;
          shares: number;
          subscribers: number;
          extra: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          principal_id: string;
          platform: string;
          content_id?: string | null;
          metric_date?: string;
          views?: number;
          comments?: number;
          likes?: number;
          shares?: number;
          subscribers?: number;
          extra?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          principal_id?: string;
          platform?: string;
          content_id?: string | null;
          metric_date?: string;
          views?: number;
          comments?: number;
          likes?: number;
          shares?: number;
          subscribers?: number;
          extra?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analytics_metrics_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      api_keys: {
        Row: {
          id: string;
          principal_id: string;
          name: string;
          prefix: string;
          token_hash: string;
          kind: "rest" | "mcp" | "wallet";
          scopes: string[];
          expires_at: string | null;
          last_used_at: string | null;
          last_used_ip: string | null;
          created_at: string;
          revoked_at: string | null;
          metadata: Json;
        };
        Insert: {
          id?: string;
          principal_id: string;
          name: string;
          prefix: string;
          token_hash: string;
          kind: "rest" | "mcp" | "wallet";
          scopes?: string[];
          expires_at?: string | null;
          last_used_at?: string | null;
          last_used_ip?: string | null;
          created_at?: string;
          revoked_at?: string | null;
          metadata?: Json;
        };
        Update: {
          id?: string;
          principal_id?: string;
          name?: string;
          prefix?: string;
          token_hash?: string;
          kind?: "rest" | "mcp" | "wallet";
          scopes?: string[];
          expires_at?: string | null;
          last_used_at?: string | null;
          last_used_ip?: string | null;
          created_at?: string;
          revoked_at?: string | null;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "api_keys_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      content_history: {
        Row: {
          id: string;
          principal_id: string;
          social_account_id: string | null;
          scheduled_post_id: string | null;
          platform: string;
          content_id: string;
          title: string | null;
          description: string | null;
          media_url: string | null;
          media_type: string | null;
          status: string | null;
          batch_id: string | null;
          created_via: "web" | "mcp" | "x402" | "api";
          extra: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          principal_id: string;
          social_account_id?: string | null;
          scheduled_post_id?: string | null;
          platform: string;
          content_id: string;
          title?: string | null;
          description?: string | null;
          media_url?: string | null;
          media_type?: string | null;
          status?: string | null;
          batch_id?: string | null;
          created_via?: "web" | "mcp" | "x402" | "api";
          extra?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          principal_id?: string;
          social_account_id?: string | null;
          scheduled_post_id?: string | null;
          platform?: string;
          content_id?: string;
          title?: string | null;
          description?: string | null;
          media_url?: string | null;
          media_type?: string | null;
          status?: string | null;
          batch_id?: string | null;
          created_via?: "web" | "mcp" | "x402" | "api";
          extra?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_history_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_history_scheduled_post_id_fkey";
            columns: ["scheduled_post_id"];
            isOneToOne: false;
            referencedRelation: "scheduled_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_history_social_account_id_fkey";
            columns: ["social_account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      failed_posts: {
        Row: {
          id: string;
          principal_id: string;
          social_account_id: string;
          platform: string;
          status:
            | "scheduled"
            | "queued"
            | "processing"
            | "posted"
            | "failed"
            | "cancelled";
          scheduled_at: string;
          posted_at: string | null;
          /** GENERATED, never include in Insert/Update */
          scheduled_at_date: string;
          post_title: string | null;
          post_description: string | null;
          post_options: Json;
          media_type: "text" | "image" | "video";
          media_storage_path: string;
          cover_image_timestamp: number | null;
          batch_id: string | null;
          error_message: string | null;
          retry_count: number;
          created_via: "web" | "mcp" | "x402" | "api";
          idempotency_key: string | null;
          x402_charge_id: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          principal_id: string;
          social_account_id: string;
          platform: string;
          status?:
            | "scheduled"
            | "queued"
            | "processing"
            | "posted"
            | "failed"
            | "cancelled";
          scheduled_at: string;
          posted_at?: string | null;
          post_title?: string | null;
          post_description?: string | null;
          post_options?: Json;
          media_type: "text" | "image" | "video";
          media_storage_path?: string;
          cover_image_timestamp?: number | null;
          batch_id?: string | null;
          error_message?: string | null;
          retry_count?: number;
          created_via?: "web" | "mcp" | "x402" | "api";
          idempotency_key?: string | null;
          x402_charge_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          principal_id?: string;
          social_account_id?: string;
          platform?: string;
          status?:
            | "scheduled"
            | "queued"
            | "processing"
            | "posted"
            | "failed"
            | "cancelled";
          scheduled_at?: string;
          posted_at?: string | null;
          post_title?: string | null;
          post_description?: string | null;
          post_options?: Json;
          media_type?: "text" | "image" | "video";
          media_storage_path?: string;
          cover_image_timestamp?: number | null;
          batch_id?: string | null;
          error_message?: string | null;
          retry_count?: number;
          created_via?: "web" | "mcp" | "x402" | "api";
          idempotency_key?: string | null;
          x402_charge_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      // ────────────────────────────────────────────────────────────────
      mcp_audit_log: {
        Row: {
          id: number;
          principal_id: string | null;
          oauth_client_id: string | null;
          api_key_id: string | null;
          session_id: string | null;
          tool_name: string;
          args_redacted: Json | null;
          result_status:
            | "ok"
            | "error"
            | "denied"
            | "rate_limited"
            | "quota_exceeded";
          latency_ms: number | null;
          ip_hash: string | null;
          user_agent: string | null;
          /** GENERATED, never include in Insert/Update */
          month: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          principal_id?: string | null;
          oauth_client_id?: string | null;
          api_key_id?: string | null;
          session_id?: string | null;
          tool_name: string;
          args_redacted?: Json | null;
          result_status:
            | "ok"
            | "error"
            | "denied"
            | "rate_limited"
            | "quota_exceeded";
          latency_ms?: number | null;
          ip_hash?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: never; // append-only; trigger blocks UPDATE
        Relationships: [
          {
            foreignKeyName: "mcp_audit_log_api_key_id_fkey";
            columns: ["api_key_id"];
            isOneToOne: false;
            referencedRelation: "api_keys";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mcp_audit_log_oauth_client_id_fkey";
            columns: ["oauth_client_id"];
            isOneToOne: false;
            referencedRelation: "mcp_oauth_clients";
            referencedColumns: ["client_id"];
          },
          {
            foreignKeyName: "mcp_audit_log_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      mcp_oauth_clients: {
        Row: {
          client_id: string;
          client_name: string;
          redirect_uris: string[];
          software_id: string | null;
          software_version: string | null;
          registered_by_user_id: string | null;
          trust_level: "unverified" | "verified" | "blocked";
          created_at: string;
          revoked_at: string | null;
          metadata: Json;
        };
        Insert: {
          client_id: string;
          client_name: string;
          redirect_uris: string[];
          software_id?: string | null;
          software_version?: string | null;
          registered_by_user_id?: string | null;
          trust_level?: "unverified" | "verified" | "blocked";
          created_at?: string;
          revoked_at?: string | null;
          metadata?: Json;
        };
        Update: {
          client_id?: string;
          client_name?: string;
          redirect_uris?: string[];
          software_id?: string | null;
          software_version?: string | null;
          registered_by_user_id?: string | null;
          trust_level?: "unverified" | "verified" | "blocked";
          created_at?: string;
          revoked_at?: string | null;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "mcp_oauth_clients_registered_by_user_id_fkey";
            columns: ["registered_by_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      mcp_sessions: {
        Row: {
          id: string;
          principal_id: string;
          oauth_client_id: string | null;
          api_key_id: string | null;
          protocol_version: string;
          started_at: string;
          last_activity_at: string;
          ended_at: string | null;
          client_name: string | null;
          client_version: string | null;
          ip_hash: string | null;
        };
        Insert: {
          id: string;
          principal_id: string;
          oauth_client_id?: string | null;
          api_key_id?: string | null;
          protocol_version?: string;
          started_at?: string;
          last_activity_at?: string;
          ended_at?: string | null;
          client_name?: string | null;
          client_version?: string | null;
          ip_hash?: string | null;
        };
        Update: {
          id?: string;
          principal_id?: string;
          oauth_client_id?: string | null;
          api_key_id?: string | null;
          protocol_version?: string;
          started_at?: string;
          last_activity_at?: string;
          ended_at?: string | null;
          client_name?: string | null;
          client_version?: string | null;
          ip_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mcp_sessions_api_key_id_fkey";
            columns: ["api_key_id"];
            isOneToOne: false;
            referencedRelation: "api_keys";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mcp_sessions_oauth_client_id_fkey";
            columns: ["oauth_client_id"];
            isOneToOne: false;
            referencedRelation: "mcp_oauth_clients";
            referencedColumns: ["client_id"];
          },
          {
            foreignKeyName: "mcp_sessions_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      platform_quotas: {
        Row: {
          platform: string;
          daily_cap: number;
          burst_cap_60s: number;
          notes: string | null;
          updated_at: string;
        };
        Insert: {
          platform: string;
          daily_cap: number;
          burst_cap_60s: number;
          notes?: string | null;
          updated_at?: string;
        };
        Update: {
          platform?: string;
          daily_cap?: number;
          burst_cap_60s?: number;
          notes?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };

      // ────────────────────────────────────────────────────────────────
      pending_tiktok_pulls: {
        Row: {
          publish_id: string;
          principal_id: string;
          social_account_id: string;
          scheduled_post_id: string | null;
          content_history_id: string | null;
          media_storage_path: string;
          status: "pending" | "completed" | "failed";
          attempt_count: number;
          last_polled_at: string | null;
          finalized_at: string | null;
          failure_reason: string | null;
          created_at: string;
        };
        Insert: {
          publish_id: string;
          principal_id: string;
          social_account_id: string;
          scheduled_post_id?: string | null;
          content_history_id?: string | null;
          media_storage_path: string;
          status?: "pending" | "completed" | "failed";
          attempt_count?: number;
          last_polled_at?: string | null;
          finalized_at?: string | null;
          failure_reason?: string | null;
          created_at?: string;
        };
        Update: {
          publish_id?: string;
          principal_id?: string;
          social_account_id?: string;
          scheduled_post_id?: string | null;
          content_history_id?: string | null;
          media_storage_path?: string;
          status?: "pending" | "completed" | "failed";
          attempt_count?: number;
          last_polled_at?: string | null;
          finalized_at?: string | null;
          failure_reason?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pending_tiktok_pulls_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pending_tiktok_pulls_social_account_id_fkey";
            columns: ["social_account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pending_tiktok_pulls_scheduled_post_id_fkey";
            columns: ["scheduled_post_id"];
            isOneToOne: false;
            referencedRelation: "scheduled_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pending_tiktok_pulls_content_history_id_fkey";
            columns: ["content_history_id"];
            isOneToOne: false;
            referencedRelation: "content_history";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      pending_direct_posts: {
        Row: {
          event_id: string;
          batch_id: string;
          principal_id: string;
          social_account_id: string;
          platform: string;
          media_storage_path: string;
          status: "processing" | "completed" | "failed";
          failure_reason: string | null;
          idempotency_key: string | null;
          created_at: string;
          finished_at: string | null;
        };
        Insert: {
          event_id: string;
          batch_id: string;
          principal_id: string;
          social_account_id: string;
          platform: string;
          media_storage_path: string;
          status?: "processing" | "completed" | "failed";
          failure_reason?: string | null;
          idempotency_key?: string | null;
          created_at?: string;
          finished_at?: string | null;
        };
        Update: {
          event_id?: string;
          batch_id?: string;
          principal_id?: string;
          social_account_id?: string;
          platform?: string;
          media_storage_path?: string;
          status?: "processing" | "completed" | "failed";
          failure_reason?: string | null;
          idempotency_key?: string | null;
          created_at?: string;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pending_direct_posts_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pending_direct_posts_social_account_id_fkey";
            columns: ["social_account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      pricing_actions: {
        Row: {
          action: string;
          display_name: string;
          usdc_price: number;
          description: string | null;
          recurrence: "one_time" | "monthly";
          effective_from: string;
          effective_until: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          action: string;
          display_name: string;
          usdc_price: number;
          description?: string | null;
          recurrence?: "one_time" | "monthly";
          effective_from?: string;
          effective_until?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          action?: string;
          display_name?: string;
          usdc_price?: number;
          description?: string | null;
          recurrence?: "one_time" | "monthly";
          effective_from?: string;
          effective_until?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      // ────────────────────────────────────────────────────────────────
      principals: {
        Row: {
          id: string;
          kind: "clerk" | "wallet";
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          metadata: Json;
        };
        Insert: {
          id: string;
          kind: "clerk" | "wallet";
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          metadata?: Json;
        };
        Update: {
          id?: string;
          kind?: "clerk" | "wallet";
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          metadata?: Json;
        };
        Relationships: [];
      };

      // ────────────────────────────────────────────────────────────────
      rate_limit_events: {
        Row: {
          id: number;
          principal_id: string | null;
          ip_hash: string | null;
          scope: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          principal_id?: string | null;
          ip_hash?: string | null;
          scope: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          principal_id?: string | null;
          ip_hash?: string | null;
          scope?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rate_limit_events_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      sanctions_screenings: {
        Row: {
          id: number;
          wallet_id: string;
          result: "clean" | "sanctioned" | "error";
          source: string;
          raw_response: Json | null;
          checked_at: string;
        };
        Insert: {
          id?: number;
          wallet_id: string;
          result: "clean" | "sanctioned" | "error";
          source: string;
          raw_response?: Json | null;
          checked_at?: string;
        };
        Update: never; // append-only
        Relationships: [
          {
            foreignKeyName: "sanctions_screenings_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      scheduled_posts: {
        Row: {
          id: string;
          principal_id: string;
          social_account_id: string;
          platform: string;
          status:
            | "scheduled"
            | "queued"
            | "processing"
            | "posted"
            | "failed"
            | "cancelled";
          scheduled_at: string;
          posted_at: string | null;
          /** GENERATED, never include in Insert/Update */
          scheduled_at_date: string;
          post_title: string | null;
          post_description: string | null;
          post_options: Json;
          media_type: "text" | "image" | "video";
          media_storage_path: string;
          cover_image_timestamp: number | null;
          batch_id: string | null;
          error_message: string | null;
          retry_count: number;
          created_via: "web" | "mcp" | "x402" | "api";
          idempotency_key: string | null;
          x402_charge_id: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          principal_id: string;
          social_account_id: string;
          platform: string;
          status?:
            | "scheduled"
            | "queued"
            | "processing"
            | "posted"
            | "failed"
            | "cancelled";
          scheduled_at: string;
          posted_at?: string | null;
          post_title?: string | null;
          post_description?: string | null;
          post_options?: Json;
          media_type: "text" | "image" | "video";
          media_storage_path?: string;
          cover_image_timestamp?: number | null;
          batch_id?: string | null;
          error_message?: string | null;
          retry_count?: number;
          created_via?: "web" | "mcp" | "x402" | "api";
          idempotency_key?: string | null;
          x402_charge_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          principal_id?: string;
          social_account_id?: string;
          platform?: string;
          status?:
            | "scheduled"
            | "queued"
            | "processing"
            | "posted"
            | "failed"
            | "cancelled";
          scheduled_at?: string;
          posted_at?: string | null;
          post_title?: string | null;
          post_description?: string | null;
          post_options?: Json;
          media_type?: "text" | "image" | "video";
          media_storage_path?: string;
          cover_image_timestamp?: number | null;
          batch_id?: string | null;
          error_message?: string | null;
          retry_count?: number;
          created_via?: "web" | "mcp" | "x402" | "api";
          idempotency_key?: string | null;
          x402_charge_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_posts_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_posts_social_account_id_fkey";
            columns: ["social_account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_posts_x402_charge_fk";
            columns: ["x402_charge_id"];
            isOneToOne: false;
            referencedRelation: "x402_charges";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      siwe_nonces: {
        Row: {
          nonce: string;
          wallet: string | null;
          expires_at: string;
          used_at: string | null;
          created_at: string;
        };
        Insert: {
          nonce: string;
          wallet?: string | null;
          expires_at: string;
          used_at?: string | null;
          created_at?: string;
        };
        Update: {
          nonce?: string;
          wallet?: string | null;
          expires_at?: string;
          used_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };

      // ────────────────────────────────────────────────────────────────
      social_accounts: {
        Row: {
          id: string;
          principal_id: string;
          platform:
            | "linkedin"
            | "tiktok"
            | "pinterest"
            | "instagram"
            | "facebook"
            | "threads"
            | "youtube"
            | "x";
          account_identifier: string;
          display_name: string | null;
          username: string | null;
          email_address: string | null;
          avatar_url: string | null;
          is_verified: boolean | null;
          follower_count: number | null;
          following_count: number | null;
          bio_description: string | null;
          is_available: boolean;
          access_token: string | null;
          refresh_token: string | null;
          token_expires_at: string | null;
          connection_id: string | null;
          extra: Json;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          principal_id: string;
          platform:
            | "linkedin"
            | "tiktok"
            | "pinterest"
            | "instagram"
            | "facebook"
            | "threads"
            | "youtube"
            | "x";
          account_identifier: string;
          display_name?: string | null;
          username?: string | null;
          email_address?: string | null;
          avatar_url?: string | null;
          is_verified?: boolean | null;
          follower_count?: number | null;
          following_count?: number | null;
          bio_description?: string | null;
          is_available?: boolean;
          access_token?: string | null;
          refresh_token?: string | null;
          token_expires_at?: string | null;
          connection_id?: string | null;
          extra?: Json;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          principal_id?: string;
          platform?:
            | "linkedin"
            | "tiktok"
            | "pinterest"
            | "instagram"
            | "facebook"
            | "threads"
            | "youtube"
            | "x";
          account_identifier?: string;
          display_name?: string | null;
          username?: string | null;
          email_address?: string | null;
          avatar_url?: string | null;
          is_verified?: boolean | null;
          follower_count?: number | null;
          following_count?: number | null;
          bio_description?: string | null;
          is_available?: boolean;
          access_token?: string | null;
          refresh_token?: string | null;
          token_expires_at?: string | null;
          connection_id?: string | null;
          extra?: Json;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "social_accounts_connection_fk";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "social_connections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_accounts_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      social_connections: {
        Row: {
          id: string;
          principal_id: string;
          initiated_via: "web" | "mcp" | "api" | "x402";
          initiated_x402_charge_id: string | null;
          platform:
            | "linkedin"
            | "tiktok"
            | "pinterest"
            | "instagram"
            | "facebook"
            | "threads"
            | "youtube"
            | "x";
          oauth_state: string;
          oauth_code_verifier: string | null;
          redirect_uri: string;
          status: "pending" | "connected" | "expired" | "failed" | "revoked";
          expires_at: string;
          connected_at: string | null;
          failed_at: string | null;
          error_code: string | null;
          error_message: string | null;
          social_account_id: string | null;
          poll_count: number;
          last_polled_at: string | null;
          last_polled_ip_hash: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          principal_id: string;
          initiated_via: "web" | "mcp" | "api" | "x402";
          initiated_x402_charge_id?: string | null;
          platform:
            | "linkedin"
            | "tiktok"
            | "pinterest"
            | "instagram"
            | "facebook"
            | "threads"
            | "youtube"
            | "x";
          oauth_state: string;
          oauth_code_verifier?: string | null;
          redirect_uri: string;
          status?: "pending" | "connected" | "expired" | "failed" | "revoked";
          expires_at: string;
          connected_at?: string | null;
          failed_at?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          social_account_id?: string | null;
          poll_count?: number;
          last_polled_at?: string | null;
          last_polled_ip_hash?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          principal_id?: string;
          initiated_via?: "web" | "mcp" | "api" | "x402";
          initiated_x402_charge_id?: string | null;
          platform?:
            | "linkedin"
            | "tiktok"
            | "pinterest"
            | "instagram"
            | "facebook"
            | "threads"
            | "youtube"
            | "x";
          oauth_state?: string;
          oauth_code_verifier?: string | null;
          redirect_uri?: string;
          status?: "pending" | "connected" | "expired" | "failed" | "revoked";
          expires_at?: string;
          connected_at?: string | null;
          failed_at?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          social_account_id?: string | null;
          poll_count?: number;
          last_polled_at?: string | null;
          last_polled_ip_hash?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_connections_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_connections_social_account_id_fkey";
            columns: ["social_account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_connections_x402_charge_fk";
            columns: ["initiated_x402_charge_id"];
            isOneToOne: false;
            referencedRelation: "x402_charges";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      stripe_invoices: {
        Row: {
          id: string;
          user_id: string;
          stripe_invoice_id: string | null;
          amount_paid_cents: number | null;
          currency: string | null;
          status: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          stripe_invoice_id?: string | null;
          amount_paid_cents?: number | null;
          currency?: string | null;
          status?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: never; // append-only
        Relationships: [
          {
            foreignKeyName: "stripe_invoices_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      stripe_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          stripe_subscription_id: string;
          stripe_customer_id: string;
          stripe_price_id: string | null;
          plan: string | null;
          status: string;
          start_date: string;
          end_date: string | null;
          current_period_end: string | null;
          cancel_reason: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          stripe_subscription_id: string;
          stripe_customer_id: string;
          stripe_price_id?: string | null;
          plan?: string | null;
          status: string;
          start_date: string;
          end_date?: string | null;
          current_period_end?: string | null;
          cancel_reason?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          stripe_subscription_id?: string;
          stripe_customer_id?: string;
          stripe_price_id?: string | null;
          plan?: string | null;
          status?: string;
          start_date?: string;
          end_date?: string | null;
          current_period_end?: string | null;
          cancel_reason?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stripe_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      usage_quotas: {
        Row: {
          principal_id: string;
          period: string;
          action: string;
          count: number;
        };
        Insert: {
          principal_id: string;
          period: string;
          action: string;
          count?: number;
        };
        Update: {
          principal_id?: string;
          period?: string;
          action?: string;
          count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "usage_quotas_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      usdc_fmv_daily: {
        Row: {
          fmv_date: string;
          usd_per_usdc: number;
          source: string;
          fetched_at: string;
        };
        Insert: {
          fmv_date: string;
          usd_per_usdc: number;
          source: string;
          fetched_at?: string;
        };
        Update: {
          fmv_date?: string;
          usd_per_usdc?: number;
          source?: string;
          fetched_at?: string;
        };
        Relationships: [];
      };

      // ────────────────────────────────────────────────────────────────
      users: {
        Row: {
          id: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          stripe_customer_id: string;
          locale: string | null;
          timezone: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          first_name?: string | null;
          last_name?: string | null;
          stripe_customer_id: string;
          locale?: string | null;
          timezone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          first_name?: string | null;
          last_name?: string | null;
          stripe_customer_id?: string;
          locale?: string | null;
          timezone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "users_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      wallet_credits: {
        Row: {
          wallet_id: string;
          balance_usdc: number;
          updated_at: string;
        };
        Insert: {
          wallet_id: string;
          balance_usdc?: number;
          updated_at?: string;
        };
        Update: {
          wallet_id?: string;
          balance_usdc?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wallet_credits_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: true;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      wallet_credits_ledger: {
        Row: {
          id: number;
          wallet_id: string;
          delta_usdc: number;
          reason: "topup" | "spend" | "refund" | "adjustment";
          related_charge_id: string | null;
          related_action: string | null;
          idempotency_key: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          wallet_id: string;
          delta_usdc: number;
          reason: "topup" | "spend" | "refund" | "adjustment";
          related_charge_id?: string | null;
          related_action?: string | null;
          idempotency_key?: string | null;
          created_at?: string;
        };
        Update: never; // append-only
        Relationships: [
          {
            foreignKeyName: "ledger_charge_fk";
            columns: ["related_charge_id"];
            isOneToOne: false;
            referencedRelation: "x402_charges";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wallet_credits_ledger_related_action_fkey";
            columns: ["related_action"];
            isOneToOne: false;
            referencedRelation: "pricing_actions";
            referencedColumns: ["action"];
          },
          {
            foreignKeyName: "wallet_credits_ledger_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      wallets: {
        Row: {
          id: string;
          address: string;
          chain: "base" | "base-sepolia" | "polygon" | "arbitrum";
          display_name: string | null;
          ens_name: string | null;
          sanctions_status: "unchecked" | "clean" | "sanctioned";
          sanctions_checked_at: string | null;
          registered_at: string;
          last_seen_at: string;
          metadata: Json;
        };
        Insert: {
          id: string;
          address: string;
          chain?: "base" | "base-sepolia" | "polygon" | "arbitrum";
          display_name?: string | null;
          ens_name?: string | null;
          sanctions_status?: "unchecked" | "clean" | "sanctioned";
          sanctions_checked_at?: string | null;
          registered_at?: string;
          last_seen_at?: string;
          metadata?: Json;
        };
        Update: {
          id?: string;
          address?: string;
          chain?: "base" | "base-sepolia" | "polygon" | "arbitrum";
          display_name?: string | null;
          ens_name?: string | null;
          sanctions_status?: "unchecked" | "clean" | "sanctioned";
          sanctions_checked_at?: string | null;
          registered_at?: string;
          last_seen_at?: string;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "wallets_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      x402_access_log: {
        Row: {
          id: number;
          principal_id: string | null;
          wallet_id: string | null;
          endpoint: string;
          action: string | null;
          charge_id: string | null;
          result_status:
            | "ok"
            | "402_required"
            | "sanctioned"
            | "rate_limited"
            | "error";
          latency_ms: number | null;
          ip_hash: string | null;
          user_agent: string | null;
          /** GENERATED, never include in Insert/Update */
          month: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          principal_id?: string | null;
          wallet_id?: string | null;
          endpoint: string;
          action?: string | null;
          charge_id?: string | null;
          result_status:
            | "ok"
            | "402_required"
            | "sanctioned"
            | "rate_limited"
            | "error";
          latency_ms?: number | null;
          ip_hash?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: never; // append-only
        Relationships: [
          {
            foreignKeyName: "x402_access_log_action_fkey";
            columns: ["action"];
            isOneToOne: false;
            referencedRelation: "pricing_actions";
            referencedColumns: ["action"];
          },
          {
            foreignKeyName: "x402_access_log_charge_id_fkey";
            columns: ["charge_id"];
            isOneToOne: false;
            referencedRelation: "x402_charges";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "x402_access_log_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "x402_access_log_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      x402_charges: {
        Row: {
          id: string;
          principal_id: string;
          wallet_id: string;
          action: string;
          amount_usdc: number;
          amount_usd_at_receipt: number | null;
          network: string;
          asset: string;
          nonce: string;
          request_id: string | null;
          payer_address: string;
          recipient_address: string;
          status: "pending" | "settled" | "failed" | "refunded";
          facilitator: string;
          facilitator_fee_usdc: number | null;
          tx_hash: string | null;
          block_number: number | null;
          scheduled_post_id: string | null;
          social_connection_id: string | null;
          error_message: string | null;
          metadata: Json;
          created_at: string;
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          principal_id: string;
          wallet_id: string;
          action: string;
          amount_usdc: number;
          amount_usd_at_receipt?: number | null;
          network?: string;
          asset?: string;
          nonce: string;
          request_id?: string | null;
          payer_address: string;
          recipient_address: string;
          status?: "pending" | "settled" | "failed" | "refunded";
          facilitator?: string;
          facilitator_fee_usdc?: number | null;
          tx_hash?: string | null;
          block_number?: number | null;
          scheduled_post_id?: string | null;
          social_connection_id?: string | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
          settled_at?: string | null;
        };
        Update: {
          id?: string;
          principal_id?: string;
          wallet_id?: string;
          action?: string;
          amount_usdc?: number;
          amount_usd_at_receipt?: number | null;
          network?: string;
          asset?: string;
          nonce?: string;
          request_id?: string | null;
          payer_address?: string;
          recipient_address?: string;
          status?: "pending" | "settled" | "failed" | "refunded";
          facilitator?: string;
          facilitator_fee_usdc?: number | null;
          tx_hash?: string | null;
          block_number?: number | null;
          scheduled_post_id?: string | null;
          social_connection_id?: string | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
          settled_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "x402_charges_action_fkey";
            columns: ["action"];
            isOneToOne: false;
            referencedRelation: "pricing_actions";
            referencedColumns: ["action"];
          },
          {
            foreignKeyName: "x402_charges_principal_id_fkey";
            columns: ["principal_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "x402_charges_scheduled_post_id_fkey";
            columns: ["scheduled_post_id"];
            isOneToOne: false;
            referencedRelation: "scheduled_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "x402_charges_social_connection_id_fkey";
            columns: ["social_connection_id"];
            isOneToOne: false;
            referencedRelation: "social_connections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "x402_charges_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };

      // ────────────────────────────────────────────────────────────────
      x402_refunds: {
        Row: {
          id: string;
          charge_id: string;
          reason: string;
          refunded_usdc: number;
          refund_tx_hash: string | null;
          initiated_by: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          charge_id: string;
          reason: string;
          refunded_usdc: number;
          refund_tx_hash?: string | null;
          initiated_by?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: never; // append-only
        Relationships: [
          {
            foreignKeyName: "x402_refunds_charge_id_fkey";
            columns: ["charge_id"];
            isOneToOne: false;
            referencedRelation: "x402_charges";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "x402_refunds_initiated_by_fkey";
            columns: ["initiated_by"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      atomic_increment_quota: {
        Args: {
          _principal_id: string;
          _period: string;
          _action: string;
          _cap: number;
        };
        Returns: number | null;
      };
      get_user_storage_bytes: {
        Args: {
          _bucket: string;
          _prefix: string;
        };
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// ─────────────────────────────────────────────────────────────────────────
// Convenience helper types, the same shape supabase-js generators emit
// ─────────────────────────────────────────────────────────────────────────

type DefaultSchema = Database["public"];

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

// ─────────────────────────────────────────────────────────────────────────
// Hand-curated enum aliases (CHECK-constraint values, not Postgres ENUMs).
// Import these in app code instead of inlining string unions.
// These are NOT auto-generated. Keep in sync manually if you change the schema.
// ─────────────────────────────────────────────────────────────────────────

export type PrincipalKind = "clerk" | "wallet";
export type ApiKeyKind = "rest" | "mcp" | "wallet";
export type WalletChain = "base" | "base-sepolia" | "polygon" | "arbitrum";
export type SanctionsStatus = "unchecked" | "clean" | "sanctioned";
export type SanctionsResult = "clean" | "sanctioned" | "error";
export type TrustLevel = "unverified" | "verified" | "blocked";

export type Platform =
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "instagram"
  | "facebook"
  | "threads"
  | "youtube"
  | "x";

export type ConnectionStatus =
  | "pending"
  | "connected"
  | "expired"
  | "failed"
  | "revoked";

export type PostStatus =
  | "scheduled"
  | "queued"
  | "processing"
  | "posted"
  | "failed"
  | "cancelled";

export type MediaType = "text" | "image" | "video";

export type CreatedVia = "web" | "mcp" | "x402" | "api";
export type InitiatedVia = CreatedVia;

export type LedgerReason = "topup" | "spend" | "refund" | "adjustment";

export type X402Status = "pending" | "settled" | "failed" | "refunded";

export type X402AccessResultStatus =
  | "ok"
  | "402_required"
  | "sanctioned"
  | "rate_limited"
  | "error";

export type McpAuditResultStatus =
  | "ok"
  | "error"
  | "denied"
  | "rate_limited"
  | "quota_exceeded";

export type PricingRecurrence = "one_time" | "monthly";

// ─────────────────────────────────────────────────────────────────────────
// Convenience row-aliases for the most-touched tables.
// Use them like:   const post: ScheduledPost = ...
// ─────────────────────────────────────────────────────────────────────────

export type Principal = Tables<"principals">;
export type User = Tables<"users">;
export type Wallet = Tables<"wallets">;
export type ApiKey = Tables<"api_keys">;
export type McpOauthClient = Tables<"mcp_oauth_clients">;
export type McpSession = Tables<"mcp_sessions">;
export type SanctionsScreening = Tables<"sanctions_screenings">;
export type SiweNonce = Tables<"siwe_nonces">;
export type SocialAccount = Tables<"social_accounts">;
export type SocialConnection = Tables<"social_connections">;
export type ScheduledPost = Tables<"scheduled_posts">;
export type FailedPost = Tables<"failed_posts">;
export type ContentHistory = Tables<"content_history">;
export type AnalyticsMetric = Tables<"analytics_metrics">;
export type StripeSubscription = Tables<"stripe_subscriptions">;
export type StripeInvoice = Tables<"stripe_invoices">;
export type PricingAction = Tables<"pricing_actions">;
export type WalletCredits = Tables<"wallet_credits">;
export type WalletCreditsLedger = Tables<"wallet_credits_ledger">;
export type X402Charge = Tables<"x402_charges">;
export type X402Refund = Tables<"x402_refunds">;
export type UsdcFmvDaily = Tables<"usdc_fmv_daily">;
export type McpAuditLog = Tables<"mcp_audit_log">;
export type X402AccessLog = Tables<"x402_access_log">;
export type UsageQuota = Tables<"usage_quotas">;
export type PendingTikTokPull = Tables<"pending_tiktok_pulls">;
export type PlatformQuota = Tables<"platform_quotas">;
export type RateLimitEvent = Tables<"rate_limit_events">;
