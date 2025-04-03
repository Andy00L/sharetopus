// lib/tiktok/config.ts
export const TIKTOK_API_CONFIG = {
  // OAuth endpoints
  AUTH_URL: "https://www.tiktok.com/auth/authorize/",
  TOKEN_URL: "https://open-api.tiktok.com/oauth/access_token/",
  REFRESH_TOKEN_URL: "https://open-api.tiktok.com/oauth/refresh_token/",
  USER_INFO_URL: "https://open-api.tiktok.com/oauth/userinfo/",

  // Content endpoints
  VIDEO_INIT_UPLOAD_URL: "https://open-api.tiktok.com/share/video/upload/",
  VIDEO_PUBLISH_URL: "https://open-api.tiktok.com/share/video/publish/",

  // Required scopes for full functionality
  SCOPES: [
    "user.info.basic",
    "video.upload",
    "video.list",
    "data.external.user",
  ],

  // Constants
  CLIENT_KEY: process.env.TIKTOK_CLIENT_KEY ?? "",
  CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET ?? "",
  REDIRECT_URI: process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/tiktok/callback`
    : "http://localhost:3000/api/auth/tiktok/callback",
};
