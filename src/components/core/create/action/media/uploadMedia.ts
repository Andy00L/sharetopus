import { uploadWithSignedUrl } from "@/actions/client/signedUrlUpload";

export async function uploadMedia(
  file: File,
  isScheduled: boolean,
  planId?: string,

  onProgress?: (progress: number) => void
): Promise<{ success: boolean; path?: string; message?: string }> {
  const uploadResult = await uploadWithSignedUrl(file, isScheduled, {
    onProgress: (progress) => {
      onProgress?.(progress);
    },

    planId,
  });

  if (uploadResult.success) {
    return {
      success: true,
      path: uploadResult.path,
    };
  } else {
    return {
      success: false,
      message: uploadResult.message ?? "Upload failed. Please try again.",
    };
  }
}
