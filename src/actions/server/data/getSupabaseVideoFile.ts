import { adminSupabase } from "@/actions/api/adminSupabase";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";
import "server-only";

/** Downloads one of the user's stored files as a Buffer; the path must start with their id. */
export async function getSupabaseVideoFile(
  filePath: string,
  userId: string | null
): Promise<{ success: boolean; message: string; buffer?: Buffer }> {
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
      .from(MEDIA_BUCKET)
      .download(filePath);

    if (error) {
      console.error(
        `[Get Supabase video File] Supabase download error for path ${filePath}:`,
        error
      );
      return {
        success: false,
        message: `Failed to download file: ${error.message}`,
      };
    }

    if (!data) {
      console.error(`[Get Supabase video File] File not found or is empty: ${filePath}`);
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
    return {
      success: false,
      message:
        err instanceof Error
          ? err.message
          : "Unexpected error retrieving file",
    };
  }
}
