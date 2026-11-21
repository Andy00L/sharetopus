"use server";
import { authCheck } from "@/actions/server/authCheck";
import { authCheckCronJob } from "../../authCheckCronJob";
import { deleteSupabaseFile, type DeleteSupabaseFileResult } from "./deleteSupabaseFile";

export async function deleteSupabaseFileAction(
  userId: string | null,
  filePath: string | null,
  forceDelete: boolean = false,
  cronSecret?: string,
): Promise<DeleteSupabaseFileResult> {
  console.log(
    `[deleteSupabaseFileAction]: Starting deletion process for user: ${userId}, path: ${
      filePath ?? "entire folder"
    }`,
  );

  if (cronSecret) {
    const authResult = await authCheckCronJob(userId, cronSecret);
    if (!authResult) {
      return {
        success: false,
        message: "Cron job authentication failed. Invalid secret key.",
      };
    }
  } else {
    const authResult = await authCheck(userId);
    if (!authResult) {
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }
  }

  if (!userId) {
    console.error("[deleteSupabaseFileAction]: No userId after auth check");
    return { success: false, message: "Missing user ID." };
  }

  return deleteSupabaseFile(userId, filePath, forceDelete);
}
