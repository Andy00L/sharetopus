import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { api_keys } from "@/db/schema";
import type { ApiKeyKind } from "@/lib/api/tokens";

/** Unrevoked keys of one kind a user may hold at a time (docs/AUTH.md, API key lifecycle). */
export const MAX_ACTIVE_API_KEYS_PER_KIND = 10;

const KIND_LABELS: Record<ApiKeyKind, string> = { mcp: "MCP", rest: "REST" };

/**
 * Whether a principal may create one more key of this kind: fewer than
 * MAX_ACTIVE_API_KEYS_PER_KIND unrevoked ones. A failed count refuses with a
 * retry message; reading it as zero let a key past the limit.
 *
 * Called by createApiKey (kind 'mcp') and createRestApiKey (kind 'rest').
 */
export async function checkActiveApiKeyCap(
  principalId: string,
  kind: ApiKeyKind,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: activeKeyCount, error } = await runQuery(
    db.$count(
      api_keys,
      and(
        eq(api_keys.principal_id, principalId),
        eq(api_keys.kind, kind),
        isNull(api_keys.revoked_at),
      ),
    ),
  );

  if (error) {
    console.error(
      `[checkActiveApiKeyCap] Active ${kind} key count failed:`,
      error.message,
    );
    return {
      ok: false,
      message: "Could not check how many keys you have. Please try again.",
    };
  }

  if (activeKeyCount >= MAX_ACTIVE_API_KEYS_PER_KIND) {
    return {
      ok: false,
      message: `Maximum ${MAX_ACTIVE_API_KEYS_PER_KIND} active ${KIND_LABELS[kind]} keys allowed. Revoke an existing key first.`,
    };
  }
  return { ok: true };
}
