// src/types/supabase.ts
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          first_name?: string | null;
          last_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          first_name?: string | null;
          last_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          plan_id: string;
          status: string;
          current_period_start: string;
          current_period_end: string;
          cancel_at_period_end: boolean;
          cancel_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          plan_id: string;
          status: string;
          current_period_start: string;
          current_period_end: string;
          cancel_at_period_end?: boolean;
          cancel_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          stripe_customer_id?: string;
          stripe_subscription_id?: string;
          plan_id?: string;
          status?: string;
          current_period_start?: string;
          current_period_end?: string;
          cancel_at_period_end?: boolean;
          cancel_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      subscription_plans: {
        Row: {
          id: string;
          name: string;
          description: string;
          price: number;
          currency: string;
          interval: "month" | "year";
          max_accounts: number;
          stripe_product_id: string;
          stripe_price_id: string;
          features: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description: string;
          price: number;
          currency: string;
          interval: "month" | "year";
          max_accounts: number;
          stripe_product_id: string;
          stripe_price_id: string;
          features?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string;
          price?: number;
          currency?: string;
          interval?: "month" | "year";
          max_accounts?: number;
          stripe_product_id?: string;
          stripe_price_id?: string;
          features?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      social_accounts: {
        Row: {
          id: string;
          user_id: string;
          platform_id: string;
          platform_account_id: string;
          username: string;
          display_name: string;
          access_token: string;
          refresh_token: string | null;
          token_expires_at: string | null;
          profile_image_url: string | null;
          is_connected: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          platform_id: string;
          platform_account_id: string;
          username: string;
          display_name: string;
          access_token: string;
          refresh_token?: string | null;
          token_expires_at?: string | null;
          profile_image_url?: string | null;
          is_connected?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          platform_id?: string;
          platform_account_id?: string;
          username?: string;
          display_name?: string;
          access_token?: string;
          refresh_token?: string | null;
          token_expires_at?: string | null;
          profile_image_url?: string | null;
          is_connected?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      platforms: {
        Row: {
          id: string;
          name: string;
          display_name: string;
          icon: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          display_name: string;
          icon: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          display_name?: string;
          icon?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      posts: {
        Row: {
          id: string;
          user_id: string;
          content: string;
          media_urls: string[] | null;
          scheduled_at: string | null;
          published_at: string | null;
          status: "draft" | "scheduled" | "published" | "failed";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          content: string;
          media_urls?: string[] | null;
          scheduled_at?: string | null;
          published_at?: string | null;
          status?: "draft" | "scheduled" | "published" | "failed";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          content?: string;
          media_urls?: string[] | null;
          scheduled_at?: string | null;
          published_at?: string | null;
          status?: "draft" | "scheduled" | "published" | "failed";
          created_at?: string;
          updated_at?: string;
        };
      };
      post_platforms: {
        Row: {
          id: string;
          post_id: string;
          social_account_id: string;
          platform_post_id: string | null;
          status: "pending" | "published" | "failed";
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          social_account_id: string;
          platform_post_id?: string | null;
          status?: "pending" | "published" | "failed";
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          social_account_id?: string;
          platform_post_id?: string | null;
          status?: "pending" | "published" | "failed";
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      rate_limits: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          count: number;
          reset_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          count: number;
          reset_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          count?: number;
          reset_at?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
