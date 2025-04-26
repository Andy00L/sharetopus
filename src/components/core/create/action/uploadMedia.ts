import { uploadWithSignedUrl } from "@/actions/client/signedUrlUpload";

export async function uploadMedia(
  file: File,
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; path?: string; message?: string }> {
  console.log("Uploading media file...");
  try {
    const path = await uploadWithSignedUrl(file, {
      onProgress: (progress) => {
        onProgress?.(progress);
      },
      onSuccess: (path) => console.log("File uploaded successfully:", path),
      onError: (error) => {
        throw error;
      },
    });

    console.log("Media uploaded to:");
    return { success: true, path };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Upload error:", error);
    return {
      success: false,
      message: `Media upload failed: ${errorMessage}`,
    };
  }
}
