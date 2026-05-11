// lib/api/pinterest/data/getPinterestBoards.ts
"use server";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";

export interface PinterestBoard {
  id: string;
  name: string;
  description?: string;
  privacy?: string;
  pin_count?: number;
}

export interface PinterestBoardsResponse {
  boards: PinterestBoard[];
  success: boolean;
  expired?: boolean;
  bookmark?: string | null;
}

/**
 * Fetches Pinterest boards for the user via Pinterest API v5.
 *
 * @param accessToken Pinterest API access token
 * @param userId User identifier for rate limiting (required)
 * @param options Optional pagination params (pageSize 1-100, bookmark cursor)
 * @returns Boards array with success/expired status and optional bookmark cursor
 */
export async function getPinterestBoards(
  accessToken: string | null,
  userId: string,
  options?: { pageSize?: number; bookmark?: string }
): Promise<PinterestBoardsResponse> {
  if (!accessToken) {
    console.error("[GetPinterestBoards] No access token provided");
    return { boards: [], success: false };
  }

  const rateCheck = await checkRateLimit("getPinterestBoards", userId, 15, 60);
  if (!rateCheck.success) {
    console.warn(
      `[GetPinterestBoards] Rate limit exceeded for user: ${userId}. Reset in: ${
        rateCheck.resetIn ?? "unknown"
      } seconds`
    );
    return { boards: [], success: false };
  }

  const pageSize = Math.max(1, Math.min(options?.pageSize ?? 25, 100));
  const params = new URLSearchParams({ page_size: String(pageSize) });
  if (options?.bookmark) {
    params.set("bookmark", options.bookmark);
  }

  try {
    const url = `https://api.pinterest.com/v5/boards?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 401) {
      console.error(
        "[GetPinterestBoards] 401 Unauthorized. Token may be expired or revoked."
      );
      return { boards: [], success: false, expired: true };
    }

    if (response.status === 429) {
      console.warn(
        "[GetPinterestBoards] 429 Rate limited by Pinterest API. Retry later."
      );
      return { boards: [], success: false, expired: false };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(
        `[GetPinterestBoards] API error: ${response.status} ${response.statusText}. ` +
          `Body: ${body.slice(0, 200)}`
      );
      return { boards: [], success: false, expired: false };
    }

    const data = (await response.json()) as {
      items?: unknown[];
      bookmark?: string;
    };
    const items: unknown[] = data.items ?? [];

    const boards: PinterestBoard[] = items.map((item) => {
      const rec = item as Record<string, unknown>;
      const privacyRaw = rec.privacy;
      const privacyValue =
        typeof privacyRaw === "string"
          ? privacyRaw
          : (privacyRaw as { value?: string } | null | undefined)?.value;
      return {
        id: String(rec.id ?? ""),
        name: String(rec.name ?? ""),
        description:
          rec.description != null ? String(rec.description) : undefined,
        privacy: privacyValue ?? undefined,
        pin_count:
          typeof rec.pin_count === "number" ? rec.pin_count : undefined,
      };
    });

    return {
      boards,
      success: true,
      bookmark: typeof data.bookmark === "string" ? data.bookmark : null,
    };
  } catch (error) {
    console.error("[GetPinterestBoards] Network or unexpected error:", error);
    return { boards: [], success: false, expired: false };
  }
}
