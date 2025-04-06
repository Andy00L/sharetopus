export type TokenExchangeResponse = {
  error_description(
    arg0: string,
    error: string,
    error_description: string
  ): unknown;
  error: string;
  token_type: string;
  refresh_expires_in: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  user_id: string;
  open_id?: string;
};
