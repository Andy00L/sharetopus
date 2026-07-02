import "server-only";

import { z } from "zod";

import type { XProfile } from "@/lib/types/socialProfiles";

/** Outbound X API calls are bounded to 15s. */
const PROFILE_TIMEOUT_MS = 15_000;

/**
 * GET /2/users/me response with the user.fields this module requests.
 * sourceRef: https://docs.x.com/x-api/users/lookup (users/me)
 */
const XUserSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    name: z.string(),
    username: z.string(),
    profile_image_url: z.string().optional(),
    verified: z.boolean().optional(),
  }),
});

export type XProfileResult =
  | { success: true; data: XProfile }
  | { success: false; message: string };

/**
 * Fetch the authorized X user. The numeric user id is the account
 * identifier stored in social_accounts.
 *
 * Called by: /api/social/x/connect, xTokenExchange (x402 flow)
 */
export async function getXProfile(
  accessToken: string,
): Promise<XProfileResult> {
  const url =
    "https://api.x.com/2/users/me?user.fields=profile_image_url,verified";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[getXProfile] HTTP ${response.status}: ${responseText}`,
      );
      return {
        success: false,
        message: `X profile fetch failed (${response.status}).`,
      };
    }

    const parsed = XUserSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error("[getXProfile] Profile response failed validation.");
      return {
        success: false,
        message: "X profile response had an unexpected shape.",
      };
    }

    const user = parsed.data.data;
    const profile: XProfile = {
      id: user.id,
      username: user.username,
      name: user.name,
      avatarUrl: user.profile_image_url ?? null,
      isVerified: user.verified ?? false,
    };

    return { success: true, data: profile };
  } catch (error) {
    console.error(
      "[getXProfile] Profile fetch error:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, message: "X profile fetch request failed." };
  }
}
