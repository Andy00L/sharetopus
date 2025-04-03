// lib/tiktok/client.ts
import { disableSocialAccount } from "@/actions/server/supabase/disableSocialAccount";
import { updateSocialAccountTokens } from "@/actions/server/supabase/updateSocialAccountTokens";
import { SocialMediaAccount } from "@/actions/types/SocialMediaAccount ";
import { Provider } from "@/actions/types/provider";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { refreshTikTokToken } from "./auth";

export class TikTokApiClient {
  private readonly client: AxiosInstance;
  private readonly userId: string;
  private readonly account: SocialMediaAccount;

  constructor(userId: string, account: SocialMediaAccount) {
    this.userId = userId;
    this.account = account;

    this.client = axios.create({
      baseURL: "https://open-api.tiktok.com",
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        "Content-Type": "application/json",
      },
    });

    // Add request interceptor for automatic token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // If error is due to invalid token and we haven't tried to refresh yet
        if (
          error.response &&
          error.response.status === 401 &&
          !originalRequest._retry &&
          this.account.refresh_token
        ) {
          originalRequest._retry = true;

          try {
            // Refresh token
            const tokenResponse = await refreshTikTokToken(
              this.account.refresh_token
            );

            // Update account in database
            const updated = await updateSocialAccountTokens(
              this.userId,
              "tiktok" as Provider,
              {
                access_token: tokenResponse.access_token,
                refresh_token: tokenResponse.refresh_token,
                expires_in: tokenResponse.expires_in,
              }
            );

            if (!updated) {
              throw new Error("Failed to update tokens in database");
            }

            // Update the client auth header and current account
            this.account.access_token = tokenResponse.access_token;
            if (tokenResponse.refresh_token) {
              this.account.refresh_token = tokenResponse.refresh_token;
            }

            originalRequest.headers[
              "Authorization"
            ] = `Bearer ${tokenResponse.access_token}`;

            // Retry the original request
            return this.client(originalRequest);
          } catch (refreshError) {
            // If refresh fails, disable the account
            await disableSocialAccount(
              this.userId,
              "tiktok" as Provider,
              "Token refresh failed"
            );

            throw refreshError;
          }
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Make a request to the TikTok API
   */
  async request<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client(config);
      return response.data;
    } catch (error) {
      console.error("TikTok API request failed:", error);
      throw error;
    }
  }
}
