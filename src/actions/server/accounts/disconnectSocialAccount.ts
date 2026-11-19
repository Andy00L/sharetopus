import { authCheck } from "@/actions/server/authCheck";
import { db, runQuery } from "@/db/client";
import { scheduled_posts, social_accounts } from "@/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import "server-only";
import { deleteUnreferencedMediaFiles } from "../data/storageFiles/deleteSupabaseFile";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

export async function disconnectSocialAccount(
  accountId: string,
  userId: string | null,
): Promise<{ success: boolean; message: string; resetIn?: number }> {
  try {
    console.log(
      `[disconnectSocialAccount] Processing account: ${accountId}, user: ${userId}`,
    );

    if (!userId || !(await authCheck(userId))) {
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }

    const rateCheck = await checkRateLimit(
      "disconnectSocialAccount",
      userId,
      30,
      60,
    );

    if (!rateCheck.success) {
      console.warn(
        `[disconnectSocialAccount]: Rate limit exceeded for user: ${userId}. Reset in: ${
          rateCheck.resetIn ?? "unknown"
        } seconds`,
      );
      return {
        success: false,
        message: rateCheck.message,
        resetIn: rateCheck.resetIn,
      };
    }

    const { data: accountRows, error: fetchError } = await runQuery(
      db
        .select({
          principal_id: social_accounts.principal_id,
          platform: social_accounts.platform,
        })
        .from(social_accounts)
        .where(eq(social_accounts.id, accountId))
        .limit(1),
    );
    if (fetchError) {
      console.error(
        `[disconnectSocialAccount]: Account fetch error:`,
        fetchError.message,
      );
      return {
        success: false,
        message: "Could not load the account. Please try again.",
      };
    }

    const account = accountRows[0];
    if (!account) {
      return {
        success: false,
        message:
          "Failed to find the social account. It may have been already disconnected.",
      };
    }

    if (account.principal_id !== userId) {
      console.warn(
        `[disconnectSocialAccount]: Unauthorized access - User ${userId} attempted to disconnect account ${accountId} owned by ${account.principal_id}`,
      );
      return {
        success: false,
        message: "You are not authorized to disconnect this account.",
      };
    }

    const { data: mediaPaths, error: postsError } = await runQuery(
      db
        .selectDistinct({ media_storage_path: scheduled_posts.media_storage_path })
        .from(scheduled_posts)
        .where(
          and(
            eq(scheduled_posts.social_account_id, accountId),
            inArray(scheduled_posts.status, ["scheduled", "queued", "processing", "cancelled"]),
            isNotNull(scheduled_posts.media_storage_path),
          ),
        ),
    );

    if (postsError) {
      console.error(
        `[disconnectSocialAccount]: Error fetching media paths:`,
        postsError.message,
      );
    }

    const filesToCheck = [
      ...new Set(
        (mediaPaths ?? [])
          .map((row) => row.media_storage_path)
          .filter((path): path is string => Boolean(path)),
      ),
    ];

    const { error: deleteError } = await runQuery(
      db.delete(social_accounts).where(eq(social_accounts.id, accountId)),
    );

    if (deleteError) {
      console.error(
        `[disconnectSocialAccount]: Account deletion error:`,
        deleteError.message,
      );
      return {
        success: false,
        message: `Failed to disconnect the account`,
      };
    }

    const mediaCleanup = await deleteUnreferencedMediaFiles(userId, filesToCheck);
    if (!mediaCleanup.success) {
      console.error(
        "[disconnectSocialAccount] Media cleanup failed:",
        mediaCleanup.message,
      );
    }
    const deletedFiles = mediaCleanup.success ? mediaCleanup.removedCount : 0;

    const platformName =
      account.platform.charAt(0).toUpperCase() + account.platform.slice(1);

    return {
      success: true,
      message: `${platformName} account disconnected${
        deletedFiles > 0
          ? ` and ${deletedFiles} unused media files cleaned up.`
          : "."
      }`,
    };
  } catch (err) {
    console.error(`[disconnectSocialAccount]: Unexpected error:`, err);
    return {
      success: false,
      message:
        "An unexpected error occurred while disconnecting the account. Please try again or contact support.",
    };
  }
}
