export type RateLimitRule = { limit: number; windowSeconds: number };

export const CHECKOUT_SESSION_RATE_LIMIT: RateLimitRule = { limit: 15, windowSeconds: 60 };
export const CUSTOMER_PORTAL_RATE_LIMIT: RateLimitRule = { limit: 20, windowSeconds: 60 };
export const DISCONNECT_SOCIAL_ACCOUNT_RATE_LIMIT: RateLimitRule = { limit: 30, windowSeconds: 60 };
export const CREATE_API_KEY_RATE_LIMIT: RateLimitRule = { limit: 10, windowSeconds: 60 };
export const CREATE_SHARE_LINK_RATE_LIMIT: RateLimitRule = { limit: 10, windowSeconds: 60 };
export const USE_SHARE_LINK_RATE_LIMIT: RateLimitRule = { limit: 5, windowSeconds: 60 };

export const HANDLE_SOCIAL_MEDIA_POST_RATE_LIMIT: RateLimitRule = { limit: 30, windowSeconds: 60 };
export const DIRECT_POST_BATCH_RATE_LIMIT: RateLimitRule = { limit: 20, windowSeconds: 60 };
export const SCHEDULE_POST_BATCH_RATE_LIMIT: RateLimitRule = { limit: 10, windowSeconds: 60 };
export const RESCHEDULE_POST_BATCH_RATE_LIMIT: RateLimitRule = { limit: 30, windowSeconds: 60 };
export const CANCEL_POST_BATCH_RATE_LIMIT: RateLimitRule = { limit: 30, windowSeconds: 60 };
export const DELETE_POST_BATCH_RATE_LIMIT: RateLimitRule = { limit: 30, windowSeconds: 60 };
export const RESUME_POST_BATCH_RATE_LIMIT: RateLimitRule = { limit: 30, windowSeconds: 60 };
export const LIST_SCHEDULED_POSTS_RATE_LIMIT: RateLimitRule = { limit: 60, windowSeconds: 60 };
export const LIST_CONTENT_HISTORY_RATE_LIMIT: RateLimitRule = { limit: 60, windowSeconds: 60 };
export const FETCH_SOCIAL_ACCOUNTS_RATE_LIMIT: RateLimitRule = { limit: 30, windowSeconds: 60 };
export const POSTS_STATUS_POLL_RATE_LIMIT: RateLimitRule = { limit: 240, windowSeconds: 60 };
export const PINTEREST_BOARDS_RATE_LIMIT: RateLimitRule = { limit: 15, windowSeconds: 60 };
export const CREATE_PINTEREST_BOARD_RATE_LIMIT: RateLimitRule = { limit: 10, windowSeconds: 60 };
export const REST_ENDPOINT_RATE_LIMIT: RateLimitRule = { limit: 20, windowSeconds: 60 };

export const OAUTH_CALLBACK_RATE_LIMIT: RateLimitRule = { limit: 60, windowSeconds: 60 };
export const X402_CONNECT_CHALLENGE_RATE_LIMIT: RateLimitRule = { limit: 10, windowSeconds: 60 };
export const X402_OAUTH_STATUS_POLL_RATE_LIMIT: RateLimitRule = { limit: 120, windowSeconds: 60 };
export const X402_FACILITATOR_VERIFY_RATE_LIMIT: RateLimitRule = { limit: 60, windowSeconds: 60 };
export const X402_FACILITATOR_SETTLE_RATE_LIMIT: RateLimitRule = { limit: 30, windowSeconds: 60 };
export const X402_FACILITATOR_SUPPORTED_RATE_LIMIT: RateLimitRule = { limit: 60, windowSeconds: 60 };
