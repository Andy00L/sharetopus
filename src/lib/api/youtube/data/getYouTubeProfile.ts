import "server-only";

import { z } from "zod";

import type { YouTubeProfile } from "@/lib/types/socialProfiles";

/** Outbound YouTube Data API calls are bounded to 15s. */
const PROFILE_TIMEOUT_MS = 15_000;

/**
 * channels.list response, part=snippet,statistics with mine=true.
 * sourceRef: https://developers.google.com/youtube/v3/docs/channels/list
 */
const YouTubeChannelsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        snippet: z.object({
          title: z.string().optional(),
          customUrl: z.string().optional(),
          description: z.string().optional(),
          thumbnails: z
            .object({
              default: z.object({ url: z.string() }).optional(),
              high: z.object({ url: z.string() }).optional(),
            })
            .optional(),
        }),
        statistics: z
          .object({
            subscriberCount: z.string().optional(),
            videoCount: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export type YouTubeProfileResult =
  | { success: true; data: YouTubeProfile }
  | { success: false; message: string };

/**
 * Fetch the authorized user's YouTube channel (id, title, avatar, stats).
 * The channel id is the account identifier stored in social_accounts.
 *
 * Called by: /api/social/youtube/connect, youtubeTokenExchange (x402 flow)
 */
export async function getYouTubeProfile(
  accessToken: string,
): Promise<YouTubeProfileResult> {
  // sourceRef: https://developers.google.com/youtube/v3/docs/channels/list
  const url =
    "https://www.googleapis.com/youtube/v3/channels" +
    "?part=snippet,statistics&mine=true";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[getYouTubeProfile] HTTP ${response.status}: ${responseText}`,
      );
      return {
        success: false,
        message: `YouTube channel fetch failed (${response.status}).`,
      };
    }

    const parsed = YouTubeChannelsSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error(
        "[getYouTubeProfile] Channel response failed validation.",
      );
      return {
        success: false,
        message: "YouTube channel response had an unexpected shape.",
      };
    }

    const channel = parsed.data.items?.[0];
    if (!channel) {
      // A Google account without a YouTube channel returns an empty items
      // list; posting is impossible for it, so the connect flow must fail.
      return {
        success: false,
        message:
          "No YouTube channel found for this Google account. Create a channel first.",
      };
    }

    const subscriberCountRaw = channel.statistics?.subscriberCount;
    const subscriberCount =
      subscriberCountRaw !== undefined ? Number(subscriberCountRaw) : null;

    const profile: YouTubeProfile = {
      channelId: channel.id,
      title: channel.snippet.title ?? "",
      customUrl: channel.snippet.customUrl ?? null,
      description: channel.snippet.description ?? null,
      avatarUrl:
        channel.snippet.thumbnails?.high?.url ??
        channel.snippet.thumbnails?.default?.url ??
        null,
      subscriberCount: Number.isNaN(subscriberCount) ? null : subscriberCount,
    };

    return { success: true, data: profile };
  } catch (error) {
    console.error(
      "[getYouTubeProfile] Channel fetch error:",
      error instanceof Error ? error.message : error,
    );
    return {
      success: false,
      message: "YouTube channel fetch request failed.",
    };
  }
}
