"use server";
import { adminSupabase } from "@/actions/api/supabase-client";
// For generating unique filenames
import { randomUUID } from "node:crypto";

/**
 * Uploads a file to a specified Supabase Storage bucket within a user-specific folder.
 *
 * @param userId - The ID of the user uploading the file.
 * @param file - The File object to upload.
 * @param bucketName - The name of the Supabase Storage bucket.
 * @param onProgress - Optional callback function to track upload progress (0-100).
 * @returns The full path of the uploaded file within the bucket.
 * @throws If the upload fails.
 */
export type ProgressCallback = (progress: number) => void;
/**
 * Interface for the progress object provided by Supabase storage upload
 */

export async function directUploadToSupabase(
  userId: string,
  file: File,
  bucketName: string
): Promise<string> {
  if (!userId) {
    throw new Error("User ID is required for upload.");
  }
  if (!file) {
    throw new Error("File is required for upload.");
  }
  if (!bucketName) {
    throw new Error("Bucket name is required for upload.");
  }

  // Generate a unique filename to avoid collisions
  const fileExtension = file.name.split(".").pop() ?? "mp4"; // Default extension if needed
  const uniqueFileName = `${randomUUID()}.${fileExtension}`;

  // Construct the path: user_id/unique_filename.ext
  const filePath = `${userId}/${uniqueFileName}`;

  console.log(
    `[Client Upload] Uploading '${file.name}' to bucket '${bucketName}' at path '${filePath}'`
  );

  try {
    // Use adminSupabase for this operation
    const { data, error } = await adminSupabase.storage
      .from(bucketName)
      .upload(filePath, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
        // Progress tracking
      });

    if (error) {
      console.error("[Client Upload] Error:", error);
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    return data.path;
  } catch (error) {
    console.error("[Client Upload] Exception:", error);
    throw error;
  }
}
