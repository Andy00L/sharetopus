import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { inngest } from "@/inngest/client";
import { buildProxiedTikTokMediaUrl } from "@/lib/api/tiktok/buildProxiedTikTokMediaUrl";
import { getServerSignedViewUrl } from "@/actions/server/data/getServerSignedViewUrl";
import {
  CAPTION_LIMITS,
  type CaptionPlatform,
} from "@/components/core/create/constants/captionLimits";
import type { PlatformOptions } from "@/lib/types/dbTypes";
import type { PostNowEventData } from "@/inngest/functions/processDirectPostHelpers";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId } from "@/lib/mcp/context";
import { randomUUID } from "crypto";
import { insertPendingDirectPosts } from "@/actions/server/data/pendingDirectPosts";

/**
 * Posts immediately (no scheduled_at) by dispatching a "post.now" event
 * to Inngest. Same pipeline as web FIX 26: processDirectPost worker
 * handles platform call, content_history write, cleanup.
 *
 * Plan gate: Starter+ (same as schedule_post).
 * Monthly cap: 100 starter / 500 creator / unlimited pro.
 *
 * Tables touched:
 *   social_accounts (read, ownership check)
 * Inngest events sent:
 *   post.now (consumed by processDirectPost worker)
 *
 * Returns: { event_id, batch_id, message }.
 * Agent confirms via list_content_history if needed.
 */
export function registerPostNow(server: McpServer): void {
  server.tool(
    "post_now",
    "Publish a post immediately (not scheduled). For media posts, call attach_media_from_url first to get a media_storage_path. Returns an event_id; check list_content_history in 30-60s to confirm.",
    {
      social_account_id: z
        .string()
        .uuid()
        .describe("ID of the social account to post to"),
      platform: z
        .enum(["linkedin", "tiktok", "pinterest", "instagram"])
        .describe("Target platform"),
      post_type: z.enum(["text", "image", "video"]).describe("Type of post"),
      title: z.string().optional().describe("Post title (used by some platforms)"),
      description: z.string().nullable().describe("Post body text / caption"),
      media_storage_path: z
        .string()
        .optional()
        .default("")
        .describe(
          "Supabase Storage path. Required for image/video. Get it from attach_media_from_url."
        ),
      cover_timestamp: z
        .number()
        .int()
        .min(1000)
        .optional()
        .describe(
          "For TikTok video: cover frame at this millisecond mark (>=1000)"
        ),
      pinterest_board_id: z
        .string()
        .optional()
        .describe("Pinterest board ID. Required for Pinterest posts."),
      pinterest_board_name: z
        .string()
        .optional()
        .describe("Pinterest board display name. Optional, for content_history."),
    },
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const start = Date.now();

      // 1. Entitlement check
      const ent = await entitlementFor(principal, "post_now");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "post_now",
          args,
          resultStatus:
            ent.reason === "platform_quota" || ent.reason === "monthly_quota"
              ? "quota_exceeded"
              : "denied",
          latencyMs: Date.now() - start,
        });
        return {
          content: [{ type: "text" as const, text: `Denied: ${ent.detail}` }],
          isError: true,
        };
      }

      // 2. Caption length validation
      const captionLimit =
        CAPTION_LIMITS[args.platform as CaptionPlatform] ??
        CAPTION_LIMITS.default;
      if (args.description && args.description.length > captionLimit) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "post_now",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Caption exceeds ${args.platform} limit of ${captionLimit} chars (got ${args.description.length}).`,
            },
          ],
          isError: true,
        };
      }

      // 3. Media required for image/video
      if (
        (args.post_type === "image" || args.post_type === "video") &&
        !args.media_storage_path
      ) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "post_now",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: "media_storage_path is required for image and video posts. Call attach_media_from_url first.",
            },
          ],
          isError: true,
        };
      }

      // 4. Pinterest requires board
      if (args.platform === "pinterest" && !args.pinterest_board_id) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "post_now",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: "pinterest_board_id is required for Pinterest posts.",
            },
          ],
          isError: true,
        };
      }

      // 5. Fetch social_account with ownership check
      const { data: account, error: accErr } = await adminSupabase
        .from("social_accounts")
        .select("id, platform, principal_id, display_name, username")
        .eq("id", args.social_account_id)
        .eq("principal_id", principal.principalId)
        .is("deleted_at", null)
        .single();

      if (accErr || !account) {
        console.error(
          "[mcp/post_now] Account fetch failed:",
          accErr?.message ?? "not found"
        );
        await logToolCall({
          principal,
          sessionId,
          toolName: "post_now",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: "Social account not found or does not belong to you.",
            },
          ],
          isError: true,
        };
      }

      if (account.platform !== args.platform) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "post_now",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Account platform (${account.platform}) does not match requested platform (${args.platform}).`,
            },
          ],
          isError: true,
        };
      }

      // 6. Mint URL per platform (mirrors handleSocialMediaPost logic)
      let mediaUrl: string | null = null;
      let tiktokMediaUrl: string | null = null;

      if (args.media_storage_path) {
        if (args.platform === "tiktok") {
          const tikResult = buildProxiedTikTokMediaUrl({
            mediaPath: args.media_storage_path,
            principalId: principal.principalId,
          });
          if (!tikResult.success) {
            console.error(
              "[mcp/post_now] TikTok proxy URL failed:",
              tikResult.message
            );
            await logToolCall({
              principal,
              sessionId,
              toolName: "post_now",
              args,
              resultStatus: "error",
              latencyMs: Date.now() - start,
            });
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Failed to build TikTok media URL: ${tikResult.message}`,
                },
              ],
              isError: true,
            };
          }
          tiktokMediaUrl = tikResult.url;
        } else {
          const signed = await getServerSignedViewUrl(args.media_storage_path);
          if (!signed.success) {
            console.error(
              "[mcp/post_now] Signed URL failed:",
              signed.message
            );
            await logToolCall({
              principal,
              sessionId,
              toolName: "post_now",
              args,
              resultStatus: "error",
              latencyMs: Date.now() - start,
            });
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Failed to mint signed URL: ${signed.message}`,
                },
              ],
              isError: true,
            };
          }
          mediaUrl = signed.url;
        }
      }

      // 7. Build event payload (exact PostNowEventData shape)
      const batchId = `mcp_${randomUUID()}`;

      const fileName = args.media_storage_path
        ? args.media_storage_path.split("/").pop() ?? ""
        : "";

      const mediaType = deriveMediaType(fileName, args.post_type);

      const platformOptions: PlatformOptions = {
        tiktok: {
          privacyLevel: "PUBLIC_TO_EVERYONE",
          disableComment: false,
          disableDuet: false,
          disableStitch: false,
        },
        pinterest: {
          privacyLevel: "PUBLIC",
          board: args.pinterest_board_id ?? "",
          link: "",
        },
        linkedin: {
          visibility: "PUBLIC",
        },
      };

      const board: PostNowEventData["board"] =
        args.platform === "pinterest"
          ? {
              boardID: args.pinterest_board_id ?? "",
              boardName: args.pinterest_board_name ?? "Board",
              accountId: args.social_account_id,
              isSelected: true,
            }
          : null;

      const dispatchId = randomUUID();

      const eventData: PostNowEventData = {
        batch_id: batchId,
        principal_id: principal.principalId,
        social_account_id: args.social_account_id,
        platform: args.platform,
        post_type: args.post_type,
        account_content: {
          accountId: args.social_account_id,
          title: args.title ?? "",
          description: args.description ?? "",
          link: "",
          isCustomized: true,
        },
        platform_options: platformOptions,
        board,
        cover_timestamp: args.cover_timestamp ?? 1000,
        file_name: fileName,
        media_type: mediaType,
        media_path: args.media_storage_path,
        media_url: mediaUrl,
        tiktok_media_url: tiktokMediaUrl,
        dispatch_id: dispatchId,
        created_via: "mcp",
      };

      // 8. Insert lock row, then send Inngest event
      const lockResult = await insertPendingDirectPosts([
        {
          event_id: dispatchId,
          batch_id: batchId,
          principal_id: principal.principalId,
          social_account_id: args.social_account_id,
          platform: args.platform,
          media_storage_path: args.media_storage_path,
        },
      ]);

      if (!lockResult.success) {
        console.error(
          "[mcp/post_now] Failed to acquire dispatch lock:",
          lockResult.message
        );
        await logToolCall({
          principal,
          sessionId,
          toolName: "post_now",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: "Could not initialize post dispatch. Please retry.",
            },
          ],
          isError: true,
        };
      }

      try {
        const sendResult = await inngest.send({
          name: "post.now",
          data: eventData,
        });

        const eventId = sendResult.ids[0] ?? "";

        console.log(
          `[mcp/post_now] Dispatched post.now event: ${eventId}, batch: ${batchId}`
        );

        await logToolCall({
          principal,
          sessionId,
          toolName: "post_now",
          args,
          resultStatus: "ok",
          latencyMs: Date.now() - start,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  event_id: eventId,
                  batch_id: batchId,
                  platform: args.platform,
                  account_display_name:
                    account.display_name ?? account.username ?? account.id,
                  message:
                    "Post dispatched. Check list_content_history in 30-60s to confirm. " +
                    "TikTok posts may take up to 2 minutes (async pull).",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[mcp/post_now] inngest.send failed:", message);
        await logToolCall({
          principal,
          sessionId,
          toolName: "post_now",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
        });
        return {
          content: [
            { type: "text" as const, text: `Failed to dispatch post: ${message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

function deriveMediaType(
  fileName: string,
  postType: "text" | "image" | "video"
): string {
  if (postType === "text") return "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (postType === "image") {
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    return "image/jpeg";
  }
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return "video/mp4";
}
