import "server-only";

import { z } from "zod";

import type { LinkedInProfile } from "@/lib/types/socialProfiles";

const PROFILE_TIMEOUT_MS = 15_000;

// OpenID Connect userinfo answer:
// https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
const LinkedInUserInfoSchema = z.object({
  sub: z.string().min(1),
  name: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  picture: z.string().optional(),
  locale: z.unknown().optional(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
});

export type LinkedInProfileResult =
  | { success: true; data: LinkedInProfile }
  | { success: false; message: string };

export async function getLinkedInProfile(
  accessToken: string,
): Promise<LinkedInProfileResult> {
  try {
    const response = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[getLinkedInProfile] HTTP ${response.status}`);
      return {
        success: false,
        message: `LinkedIn profile request failed (${response.status}).`,
      };
    }

    const parsed = LinkedInUserInfoSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error("[getLinkedInProfile] Profile answer failed validation.");
      return {
        success: false,
        message: "LinkedIn profile answer had an unexpected shape.",
      };
    }

    const userInfo = parsed.data;
    return {
      success: true,
      data: {
        id: userInfo.sub,
        name: userInfo.name ?? "",
        given_name: userInfo.given_name ?? "",
        family_name: userInfo.family_name ?? "",
        email: userInfo.email ?? "",
        picture: userInfo.picture ?? "",
        locale: typeof userInfo.locale === "string" ? userInfo.locale : "",
        email_verified: userInfo.email_verified ?? false,
      },
    };
  } catch (error) {
    console.error(
      "[getLinkedInProfile] Profile request failed:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, message: "LinkedIn profile request failed." };
  }
}
