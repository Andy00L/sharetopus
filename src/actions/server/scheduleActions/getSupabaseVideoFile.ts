"use server";

import { adminSupabase } from "@/actions/api/supabase-client";

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
): Promise<Buffer> {
  if (!userId) {
    throw new Error("User not authenticated.");
  }

  // Security Check: Ensure the file path starts with the user's ID
  if (!filePath?.startsWith(`${userId}/`)) {
    console.warn(
      `[Get Supabase File] Attempt to access invalid/unauthorized path by user ${userId}: ${filePath}`
    );
    throw new Error("Invalid file path or unauthorized access.");
  }

  try {
    console.log(
      `[Get Supabase File] Fetching file for user ${userId}: ${filePath}`
    );

    // Get the file from Supabase Storage
    const { data, error } = await adminSupabase.storage
      .from("scheduled-videos") // Bucket name
      .download(filePath);

    if (error) {
      console.error(
        `[Get Supabase File] Supabase download error for path ${filePath}:`,
        error
      );
      throw new Error(`Failed to download file: ${error.message}`);
    }

    if (!data) {
      throw new Error("File not found or is empty");
    }

    // Convert the downloaded blob to buffer for server-side processing
    const buffer = Buffer.from(await data.arrayBuffer());

    console.log(
      `[Get Supabase File] Successfully retrieved file: ${filePath} (${buffer.length} bytes)`
    );
    return buffer;
  } catch (err) {
    console.error(
      `[Get Supabase File] Unexpected error retrieving ${filePath}:`,
      err
    );
    throw err;
  }
}
