// lib/api/pinterest/data/getPinterestBoards.ts
// Server-only library function, NOT a server action: it takes a raw access
// token, so exposing it as an action would hand out an open Pinterest
// proxy. Client components go through pinterestBoardsForAccount.ts, which
// resolves the token by account id after an ownership check.
import "server-only";

import { z } from "zod";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { readStringField } from "@/lib/platforms/providers/_shared/providerFetch";

/** One page of GET /v5/boards (items plus a bookmark cursor); board fields are read leniently below. */
const PinterestBoardsPageSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).optional(),
  bookmark: z.unknown().optional(),
});

export interface PinterestBoard {
  id: string;
  name: string;
  description?: string;
  privacy?: string;
  pin_count?: number;
}

/**
 * Why no boards came back, so each caller can answer truthfully:
 *   - token_missing: no usable token for the account
 *   - token_expired: Pinterest refused the token (401); the user reconnects
 *   - rate_limited: our per-user limit or Pinterest's own 429; resetIn
 *     carries our wait when we know it
 *   - unavailable: our rate limiter could not answer; retry
 *   - upstream_error: Pinterest failed or could not be reached
 */
export type PinterestBoardsFailure =
  | "token_missing"
  | "token_expired"
  | "rate_limited"
  | "unavailable"
  | "upstream_error";

export type PinterestBoardsResponse =
  | { success: true; boards: PinterestBoard[]; bookmark: string | null }
  | { success: false; failure: PinterestBoardsFailure; resetIn?: number };

/**
 * Fetches Pinterest boards for the user via Pinterest API v5.
 *
 * @param accessToken Pinterest API access token
 * @param userId User identifier for rate limiting (required)
 * @param options Optional pagination params (pageSize 1-100, bookmark cursor)
 * @returns The boards and the next bookmark, or the failure reason
 */
export async function getPinterestBoards(
  accessToken: string | null,
  userId: string,
  options?: { pageSize?: number; bookmark?: string }
): Promise<PinterestBoardsResponse> {
  if (!accessToken) {
    console.error("[GetPinterestBoards] No access token provided");
    return { success: false, failure: "token_missing" };
  }

  const rateCheck = await checkRateLimit("getPinterestBoards", userId, 15, 60);
  if (!rateCheck.success) {
    console.warn(
      `[GetPinterestBoards] Rate limit refused (${rateCheck.reason}) for user: ${userId}`
    );
    return rateCheck.reason === "limited"
      ? { success: false, failure: "rate_limited", resetIn: rateCheck.resetIn }
      : { success: false, failure: "unavailable" };
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
      return { success: false, failure: "token_expired" };
    }

    if (response.status === 429) {
      console.warn(
        "[GetPinterestBoards] 429 Rate limited by Pinterest API. Retry later."
      );
      return { success: false, failure: "rate_limited" };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(
        `[GetPinterestBoards] API error: ${response.status} ${response.statusText}. ` +
          `Body: ${body.slice(0, 200)}`
      );
      return { success: false, failure: "upstream_error" };
    }

    const payload: unknown = await response.json();
    const page = PinterestBoardsPageSchema.safeParse(payload);
    if (!page.success) {
      console.error("[GetPinterestBoards] Boards response had an unexpected shape");
      return { success: false, failure: "upstream_error" };
    }

    const boards: PinterestBoard[] = (page.data.items ?? []).map((board) => {
      // privacy is a plain string or an object carrying it in `value`.
      const privacyValue =
        typeof board.privacy === "string"
          ? board.privacy
          : readStringField(board.privacy, "value");
      return {
        id: String(board.id ?? ""),
        name: String(board.name ?? ""),
        description:
          board.description != null ? String(board.description) : undefined,
        privacy: privacyValue ?? undefined,
        pin_count:
          typeof board.pin_count === "number" ? board.pin_count : undefined,
      };
    });

    return {
      boards,
      success: true,
      bookmark:
        typeof page.data.bookmark === "string" ? page.data.bookmark : null,
    };
  } catch (error) {
    console.error("[GetPinterestBoards] Network or unexpected error:", error);
    return { success: false, failure: "upstream_error" };
  }
}
