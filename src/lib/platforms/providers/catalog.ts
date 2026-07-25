import type { ProviderMetadata } from "./types";

/**
 * Client-safe metadata for every publishing target.
 *
 * Deliberately free of implementation imports: the connect UI, the REST
 * validation schemas, and the MCP tool schemas all read this, and pulling a
 * provider's network code in would ship credential-handling code to the
 * browser. Behavior lives in registry.ts behind "server-only".
 *
 * Adding a provider means one entry here, one module under this folder, and
 * one line in registry.ts. The four legacy per-platform switch statements
 * are not touched: the seven original platforms keep their bespoke adapters
 * until they are migrated onto this contract one at a time.
 *
 * Every provider in this first batch is credentials-based on purpose. They
 * need no app registration and no OAuth review, so each one works the
 * moment its key is pasted, which is the "when I get the API keys it just
 * works" requirement.
 */

/** Bluesky posts cap at 300 graphemes. sourceRef: atproto app.bsky.feed.post */
const BLUESKY_MAX_CHARS = 300;
/** Mastodon's default instance limit; instances may raise it. */
const MASTODON_MAX_CHARS = 500;
/** Telegram sendMessage caps at 4096 UTF-8 chars. */
const TELEGRAM_MAX_CHARS = 4096;
/** Discord webhook content caps at 2000 chars. */
const DISCORD_MAX_CHARS = 2000;
/** Slack chat.postMessage practical text ceiling. */
const SLACK_MAX_CHARS = 40_000;
/** Sanity ceiling for long-form bodies; not an API limit. */
const ARTICLE_MAX_CHARS = 100_000;

export const PROVIDER_CATALOG: Readonly<Record<string, ProviderMetadata>> = {
  bluesky: {
    id: "bluesky",
    label: "Bluesky",
    category: "social",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: BLUESKY_MAX_CHARS,
      supportedMediaTypes: ["text", "image"],
      maxMediaPerPost: 4,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "service",
        label: "Service URL",
        kind: "url",
        required: false,
        placeholder: "https://bsky.social",
        helpText:
          "Leave blank unless you are on a self-hosted PDS. Defaults to https://bsky.social.",
      },
      {
        key: "identifier",
        label: "Handle",
        kind: "text",
        required: true,
        placeholder: "you.bsky.social",
        helpText: "Your full Bluesky handle, without the leading @.",
      },
      {
        key: "appPassword",
        label: "App password",
        kind: "secret",
        required: true,
        placeholder: "xxxx-xxxx-xxxx-xxxx",
        helpText:
          "Bluesky app password from Settings, App Passwords. Not your account password.",
      },
    ],
    tools: [],
  },

  mastodon: {
    id: "mastodon",
    label: "Mastodon",
    category: "social",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: MASTODON_MAX_CHARS,
      supportedMediaTypes: ["text", "image", "video"],
      maxMediaPerPost: 4,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "instanceUrl",
        label: "Instance URL",
        kind: "url",
        required: true,
        placeholder: "https://mastodon.social",
        helpText:
          "Your Mastodon server. Any instance works, including self-hosted ones.",
      },
      {
        key: "accessToken",
        label: "Access token",
        kind: "secret",
        required: true,
        placeholder: "",
        helpText:
          "Instance settings, Development, New application. Needs the write:statuses and write:media scopes.",
        mapsTo: "access_token",
      },
    ],
    tools: [],
  },

  telegram: {
    id: "telegram",
    label: "Telegram",
    category: "chat",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: TELEGRAM_MAX_CHARS,
      supportedMediaTypes: ["text", "image", "video"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "botToken",
        label: "Bot token",
        kind: "secret",
        required: true,
        placeholder: "123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        helpText: "Token from @BotFather after creating your bot.",
        mapsTo: "access_token",
      },
      {
        key: "chatId",
        label: "Channel or chat ID",
        kind: "text",
        required: true,
        placeholder: "@yourchannel",
        helpText:
          "Public channel username with @, or the numeric chat ID. Add the bot as an administrator first.",
      },
    ],
    tools: [
      {
        methodName: "getChatInfo",
        description:
          "Resolves a channel username or chat ID and returns its title and type, so a caller can confirm the bot can post there before scheduling.",
        parameters: [
          {
            name: "chatId",
            kind: "string",
            required: true,
            description: "Channel username with @, or numeric chat ID.",
          },
        ],
      },
    ],
  },

  discord: {
    id: "discord",
    label: "Discord",
    category: "chat",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: DISCORD_MAX_CHARS,
      supportedMediaTypes: ["text", "image", "video"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        kind: "secret",
        required: true,
        placeholder: "https://discord.com/api/webhooks/...",
        helpText:
          "Channel settings, Integrations, Webhooks, New Webhook, then Copy Webhook URL.",
        mapsTo: "access_token",
      },
    ],
    tools: [],
  },

  slack: {
    id: "slack",
    label: "Slack",
    category: "chat",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: SLACK_MAX_CHARS,
      supportedMediaTypes: ["text", "image", "video"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "botToken",
        label: "Bot token",
        kind: "secret",
        required: true,
        placeholder: "xoxb-...",
        helpText:
          "Create an app at api.slack.com/apps, add the chat:write scope, install it to your workspace, then copy the Bot User OAuth Token.",
        mapsTo: "access_token",
      },
      {
        key: "channelId",
        label: "Channel ID",
        kind: "text",
        required: true,
        placeholder: "C0123456789",
        helpText:
          "Right-click the channel, View channel details, and copy the ID at the bottom. Invite the bot to the channel first.",
      },
    ],
    tools: [
      {
        methodName: "listChannels",
        description:
          "Lists the workspace's public channels with their IDs and whether the bot is already a member, so a caller can pick a valid target before scheduling.",
        parameters: [],
      },
    ],
  },

  devto: {
    id: "devto",
    label: "Dev.to",
    category: "blog",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: ARTICLE_MAX_CHARS,
      supportedMediaTypes: ["text", "image"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "apiKey",
        label: "API key",
        kind: "secret",
        required: true,
        placeholder: "",
        helpText:
          "dev.to Settings, Extensions, DEV Community API Keys. Generate a key and paste it here.",
        mapsTo: "access_token",
      },
    ],
    tools: [],
  },

  wordpress: {
    id: "wordpress",
    label: "WordPress",
    category: "blog",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: ARTICLE_MAX_CHARS,
      supportedMediaTypes: ["text", "image"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "siteUrl",
        label: "Site URL",
        kind: "url",
        required: true,
        placeholder: "https://example.com",
        helpText:
          "Your site's address. Must be https: WordPress refuses application passwords over plain http.",
      },
      {
        key: "username",
        label: "Username",
        kind: "text",
        required: true,
        placeholder: "admin",
        helpText: "The WordPress user the posts will be published as.",
      },
      {
        key: "applicationPassword",
        label: "Application password",
        kind: "secret",
        required: true,
        placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx",
        helpText:
          "Users, Profile, Application Passwords, add a new one. Paste it with or without spaces. Not your login password.",
      },
    ],
    tools: [],
  },
};

/** OAuth providers: env pairs gate availability (see requiredEnv). */
const OAUTH_CATALOG: Readonly<Record<string, ProviderMetadata>> = {
  reddit: {
    id: "reddit",
    label: "Reddit",
    category: "social",
    authKind: "oauth2",
    requiredEnv: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
    rules: {
      maxTextLength: 40_000,
      supportedMediaTypes: ["text", "image", "video"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    tools: [
      {
        methodName: "listFlairs",
        description:
          "Lists the link flairs available in a subreddit so a caller can pass a valid flairId when scheduling.",
        parameters: [
          {
            name: "subreddit",
            kind: "string",
            required: true,
            description: "Subreddit name, without the r/ prefix.",
          },
        ],
      },
    ],
  },
  threads: {
    id: "threads",
    label: "Threads",
    category: "social",
    authKind: "oauth2",
    requiredEnv: ["THREADS_CLIENT_ID", "THREADS_CLIENT_SECRET"],
    rules: {
      maxTextLength: 500,
      supportedMediaTypes: ["text", "image", "video"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    tools: [],
  },
  tumblr: {
    id: "tumblr",
    label: "Tumblr",
    category: "social",
    authKind: "oauth2",
    requiredEnv: ["TUMBLR_CLIENT_ID", "TUMBLR_CLIENT_SECRET"],
    rules: {
      maxTextLength: ARTICLE_MAX_CHARS,
      supportedMediaTypes: ["text", "image", "video"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    tools: [
      {
        methodName: "listBlogs",
        description:
          "Lists the blogs on the connected Tumblr account so a caller can target one via options.blog.",
        parameters: [],
      },
    ],
  },
  twitch: {
    id: "twitch",
    label: "Twitch",
    category: "video",
    authKind: "oauth2",
    requiredEnv: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"],
    rules: {
      // Twitch chat message ceiling.
      maxTextLength: 500,
      supportedMediaTypes: ["text"],
      maxMediaPerPost: 0,
      mediaRequired: false,
    },
    tools: [],
  },
  kick: {
    id: "kick",
    label: "Kick",
    category: "video",
    authKind: "oauth2_pkce",
    requiredEnv: ["KICK_CLIENT_ID", "KICK_CLIENT_SECRET"],
    rules: {
      maxTextLength: 500,
      supportedMediaTypes: ["text"],
      maxMediaPerPost: 0,
      mediaRequired: false,
    },
    tools: [],
  },
};

/** Additional credentials providers (no app registration needed). */
const CREDENTIALS_CATALOG: Readonly<Record<string, ProviderMetadata>> = {
  hashnode: {
    id: "hashnode",
    label: "Hashnode",
    category: "blog",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: ARTICLE_MAX_CHARS,
      supportedMediaTypes: ["text", "image"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "apiToken",
        label: "API token",
        kind: "secret",
        required: true,
        placeholder: "",
        helpText: "Hashnode account settings, Developer, Personal Access Token.",
        mapsTo: "access_token",
      },
    ],
    tools: [
      {
        methodName: "listPublications",
        description:
          "Lists the account's publications so a caller can target one via options.publicationId.",
        parameters: [],
      },
    ],
  },
  medium: {
    id: "medium",
    label: "Medium",
    category: "blog",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: ARTICLE_MAX_CHARS,
      supportedMediaTypes: ["text", "image"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "integrationToken",
        label: "Integration token",
        kind: "secret",
        required: true,
        placeholder: "",
        helpText:
          "Medium Settings, Security, Integration tokens. Medium no longer issues new tokens; only accounts that already have one can connect.",
        mapsTo: "access_token",
      },
    ],
    tools: [],
  },
  lemmy: {
    id: "lemmy",
    label: "Lemmy",
    category: "social",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: 10_000,
      supportedMediaTypes: ["text", "image", "video"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "instanceUrl",
        label: "Instance URL",
        kind: "url",
        required: true,
        placeholder: "https://lemmy.world",
        helpText: "Your Lemmy server. Any instance works.",
      },
      {
        key: "username",
        label: "Username",
        kind: "text",
        required: true,
        placeholder: "",
        helpText: "Your username or email on that instance.",
      },
      {
        key: "password",
        label: "Password",
        kind: "secret",
        required: true,
        placeholder: "",
        helpText:
          "Used once to open a session; only the session token is stored, never the password.",
      },
    ],
    tools: [
      {
        methodName: "listCommunities",
        description:
          "Lists the communities the account subscribes to so a caller can pass a valid options.communityId.",
        parameters: [],
      },
    ],
  },
  farcaster: {
    id: "farcaster",
    label: "Farcaster",
    category: "social",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: 320,
      supportedMediaTypes: ["text", "image", "video"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "neynarApiKey",
        label: "Neynar API key",
        kind: "secret",
        required: true,
        placeholder: "",
        helpText: "From dev.neynar.com. The free tier is enough for casting.",
        mapsTo: "access_token",
      },
      {
        key: "signerUuid",
        label: "Signer UUID",
        kind: "text",
        required: true,
        placeholder: "",
        helpText:
          "An approved Neynar managed signer for your Farcaster account (approve it once in Warpcast).",
      },
    ],
    tools: [],
  },
  listmonk: {
    id: "listmonk",
    label: "Listmonk",
    category: "business",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: ARTICLE_MAX_CHARS,
      supportedMediaTypes: ["text", "image"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "instanceUrl",
        label: "Instance URL",
        kind: "url",
        required: true,
        placeholder: "https://news.example.com",
        helpText: "Your self-hosted Listmonk address.",
      },
      {
        key: "apiUser",
        label: "API user",
        kind: "text",
        required: true,
        placeholder: "api_user",
        helpText: "Listmonk Settings, Users: an API user, not your admin login.",
      },
      {
        key: "apiToken",
        label: "API token",
        kind: "secret",
        required: true,
        placeholder: "",
        helpText: "The token issued for that API user.",
      },
      {
        key: "listId",
        label: "List ID",
        kind: "text",
        required: true,
        placeholder: "1",
        helpText: "Numeric id of the subscriber list campaigns are sent to.",
      },
    ],
    tools: [],
  },
};

/** OAuth variants and approval-gated APIs (code complete; activate on env). */
const VARIANT_CATALOG: Readonly<Record<string, ProviderMetadata>> = {
  linkedin_page: {
    id: "linkedin_page",
    label: "LinkedIn Page",
    category: "business",
    authKind: "oauth2",
    // Reuses the existing LinkedIn app; only the scopes differ.
    requiredEnv: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    rules: {
      maxTextLength: 3000,
      supportedMediaTypes: ["text", "image", "video"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    tools: [
      {
        methodName: "listPages",
        description:
          "Lists the company pages this account administers so a caller can target one via options.organizationId.",
        parameters: [],
      },
    ],
  },
  dribbble: {
    id: "dribbble",
    label: "Dribbble",
    category: "business",
    authKind: "oauth2",
    requiredEnv: ["DRIBBBLE_CLIENT_ID", "DRIBBBLE_CLIENT_SECRET"],
    rules: {
      maxTextLength: 10_000,
      supportedMediaTypes: ["image"],
      maxMediaPerPost: 1,
      mediaRequired: true,
    },
    tools: [],
  },
  gmb: {
    id: "gmb",
    label: "Google Business",
    category: "business",
    authKind: "oauth2",
    requiredEnv: ["GMB_CLIENT_ID", "GMB_CLIENT_SECRET"],
    rules: {
      // localPosts summary ceiling.
      maxTextLength: 1500,
      supportedMediaTypes: ["text", "image"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    tools: [
      {
        methodName: "listLocations",
        description:
          "Lists the business locations under the connected account so a caller can pass a valid options.locationName.",
        parameters: [],
      },
    ],
  },
  nostr: {
    id: "nostr",
    label: "Nostr",
    category: "social",
    authKind: "credentials",
    requiredEnv: [],
    rules: {
      maxTextLength: 10_000,
      supportedMediaTypes: ["text", "image", "video"],
      maxMediaPerPost: 1,
      mediaRequired: false,
    },
    credentialFields: [
      {
        key: "privateKey",
        label: "Private key (hex)",
        kind: "secret",
        required: true,
        placeholder: "64 hex characters",
        helpText:
          "Your Nostr private key as 64 hex characters. Convert an nsec key to hex in your Nostr client first.",
        mapsTo: "access_token",
      },
      {
        key: "relays",
        label: "Relays",
        kind: "text",
        required: true,
        placeholder: "wss://relay.damus.io, wss://nos.lol",
        helpText: "Up to five wss:// relay URLs, separated by commas.",
      },
    ],
    tools: [],
  },
};

/** Merged view served to the registry and the connect UI. */
export const FULL_PROVIDER_CATALOG: Readonly<Record<string, ProviderMetadata>> =
  {
    ...PROVIDER_CATALOG,
    ...OAUTH_CATALOG,
    ...CREDENTIALS_CATALOG,
    ...VARIANT_CATALOG,
  };

/** Every provider id served by the registry. */
export const PROVIDER_IDS: readonly string[] = Object.keys(
  FULL_PROVIDER_CATALOG,
);

/** Metadata lookup. Returns null for unknown ids so callers fail closed. */
export function getProviderMetadata(
  providerId: string,
): ProviderMetadata | null {
  return FULL_PROVIDER_CATALOG[providerId] ?? null;
}
