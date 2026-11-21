import "server-only";

import { z } from "zod";

import { META_GRAPH_API_VERSION } from "@/lib/api/_shared/metaGraphApiVersion";
import type { InstagramProfile } from "@/lib/types/dbTypes";

const PROFILE_TIMEOUT_MS = 15_000;

const ERROR_BODY_LOG_LIMIT = 300;

// /me user_id is the Instagram professional account ID that content publishing
// posts under, so the account row is keyed on it:
// https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started
const InstagramMeSchema = z.object({
  user_id: z.union([z.string().min(1), z.number()]),
  username: z.string().optional(),
  name: z.string().optional(),
  account_type: z.string().optional(),
  profile_picture_url: z.string().optional(),
  followers_count: z.number().optional(),
  follows_count: z.number().optional(),
});

const InstagramMeAnswerSchema = z.union([
  z.object({ data: z.array(InstagramMeSchema).nonempty() }),
  InstagramMeSchema,
]);

export type InstagramProfileResult =
  | { success: true; data: InstagramProfile }
  | { success: false; message: string };

export async function getInstagramProfile(
  accessToken: string,
): Promise<InstagramProfileResult> {
  const fields = [
    "user_id",
    "username",
    "name",
    "account_type",
    "profile_picture_url",
    "followers_count",
    "follows_count",
  ].join(",");

  try {
    const response = await fetch(
      `https://graph.instagram.com/${META_GRAPH_API_VERSION}/me?${new URLSearchParams({
        fields,
        access_token: accessToken,
      })}`,
      { signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS) },
    );
    const responseText = await response.text();
    if (!response.ok) {
      console.error(
        `[getInstagramProfile] HTTP ${response.status}: ${responseText.slice(0, ERROR_BODY_LOG_LIMIT)}`,
      );
      return {
        success: false,
        message: `Instagram profile request failed (${response.status}).`,
      };
    }

    const parsed = InstagramMeAnswerSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error("[getInstagramProfile] Profile answer failed validation.");
      return {
        success: false,
        message: "Instagram profile answer had an unexpected shape.",
      };
    }

    const me = "data" in parsed.data ? parsed.data.data[0] : parsed.data;
    return {
      success: true,
      data: {
        id: String(me.user_id),
        username: me.username ?? null,
        name: me.name ?? null,
        account_type: me.account_type ?? null,
        profile_picture_url: me.profile_picture_url ?? null,
        followers_count: me.followers_count ?? null,
        follows_count: me.follows_count ?? null,
      },
    };
  } catch (error) {
    console.error(
      "[getInstagramProfile] Profile request failed:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, message: "Instagram profile request failed." };
  }
}
