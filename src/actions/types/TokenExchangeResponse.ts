export type TokenExchangeResponse = {
  token_type: string;
  refresh_expires_in: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  user_id: string;
  open_id?: string;
};
