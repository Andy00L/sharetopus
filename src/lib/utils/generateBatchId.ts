import { nanoid } from "nanoid";

/**
 * Generates a 32-character batch_id for grouping related social posts.
 *
 * Every post creation path (web UI, MCP schedule_post, MCP bulk_schedule,
 * MCP post_now, MCP bulk_post_now, future REST) MUST call this helper
 * when the caller has not supplied a batch_id explicitly.
 *
 * Format: nanoid(32) using the default URL-safe alphabet (A-Z, a-z, 0-9,
 * _, -). 32 chars provides 191 bits of entropy, well above what is needed
 * for grouping uniqueness over the product's lifetime.
 *
 * Why a shared helper rather than inline generation: the codebase
 * previously had 4 independent generation sites using 2 different
 * algorithms (nanoid(32) and crypto.randomUUID, some with an `mcp_`
 * prefix). The `created_via` column on scheduled_posts and
 * pending_direct_posts already tracks origin, so the prefix is
 * redundant. This helper unifies all paths.
 *
 * Pure function. Never throws.
 */
export function generateBatchId(): string {
  return nanoid(32);
}
