import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { api_keys } from "@/db/schema";
import type { ApiKeyKind } from "@/lib/api/tokens";

export const MAX_ACTIVE_API_KEYS_PER_KIND = 10;

const KIND_LABELS: Record<ApiKeyKind, string> = { mcp: "MCP", rest: "REST" };

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
