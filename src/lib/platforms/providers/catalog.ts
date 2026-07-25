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

/** Every provider id served by the registry. */
export const PROVIDER_IDS: readonly string[] = Object.keys(PROVIDER_CATALOG);

/** Metadata lookup. Returns null for unknown ids so callers fail closed. */
export function getProviderMetadata(
  providerId: string,
): ProviderMetadata | null {
  return PROVIDER_CATALOG[providerId] ?? null;
}
