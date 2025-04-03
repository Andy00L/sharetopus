export type TokenExchangeResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  user_id: string;
  open_id?: string;
};
