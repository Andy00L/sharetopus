"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { validateUserAuthorization } from "@/actions/authentificationCheck";

/**
 * Retrieves a video file from Supabase Storage
 *
 * @param filePath Path to the file in Supabase Storage
 * @param userId ID of the authenticated user
 * @returns Buffer containing the file data
 */
export async function getSupabaseVideoFile(
  filePath: string,
  userId: string | null
): Promise<{ success: boolean; message: string; buffer?: Buffer }> {
  const isAuth = await validateUserAuthorization(userId);
  if (!isAuth) {
    return {
      success: false,
      message: "You are not authorized to disconnect this account.",
    };
  }
  // Security Check: Ensure the file path starts with the user's ID
  if (!filePath?.startsWith(`${userId}/`)) {
    console.warn(
      `[Get Supabase video File]  Attempt to access invalid/unauthorized path by user ${userId}: ${filePath}`
    );
    return {
      success: false,
      message: "Invalid file path or unauthorized access.",
    };
  }

  try {
    console.log(
      `[Get Supabase video File]  Fetching file for user ${userId}: ${filePath}`
    );

    // Get the file from Supabase Storage
    const { data, error } = await adminSupabase.storage
      .from("scheduled-videos") // Bucket name
      .download(filePath);

    if (error) {
      console.error(
        `[Get Supabase video File] Supabase download error for path ${filePath}:`,
        error
      );
      console.error("File not found or is empty");
      return {
        success: false,
        message: "Failed to download file: ${error.message}",
      };
    }

    if (!data) {
      console.error("File not found or is empty");
      return {
        success: false,
        message: "File not found or is empty",
      };
    }

    // Convert the downloaded blob to buffer for server-side processing
    const buffer = Buffer.from(await data.arrayBuffer());

    console.log(
      `[Get Supabase video File]  Successfully retrieved file: ${filePath} (${buffer.length} bytes)`
    );
    return {
      success: true,
      message: "Successfully retrieved file",
      buffer: buffer,
    };
  } catch (err) {
    console.error(
      `[Get Supabase video File]  Unexpected error retrieving ${filePath}:`,
      err
    );
    throw err;
  }
}
