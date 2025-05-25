// lib/client/signedUrlUpload.ts
/**
 * Type for the response from the generate-upload-url API
 */
export interface SignedUrlResponse {
  success: boolean;
  uploadUrl?: string;
  path?: string;
  token?: string;
  error?: string;
  message?: string;
}

/**
 * Options for the uploadWithSignedUrl function
 */
export interface UploadOptions {
  onProgress?: (progress: number) => void;
  onSuccess?: (path: string) => void;
  onError?: (error: Error) => void;
  planId?: string;
}

/**
 * Request a signed upload URL from the server
 */
export async function getSignedUploadUrl(
  filename: string,

  contentType: string,
  fileSize: number,
  isScheduled: boolean,
  planId?: string,

  bucketName: string = "scheduled-videos"
): Promise<SignedUrlResponse> {
  try {
    const response = await fetch("/api/storage/generate-upload-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename,
        contentType,
        fileSize,
        planId,
        isScheduled,
        bucketName,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error ?? "Failed to generate upload URL",
        message: data.message ?? "Failed to generate upload URL",
      };
    }

    return data;
  } catch (error) {
    console.error("[Signed URL] Error getting signed URL:", error);
    return {
      success: false,
      error: "Connection error",
      message: "Failed to connect to upload service. Please try again.",
    };
  }
}

/**
 * Upload a file using a signed URL
 */
export async function uploadWithSignedUrl(
  file: File,
  isScheduled: boolean,
  options: UploadOptions & { planId?: string } = {}
): Promise<{ success: boolean; path?: string; message?: string }> {
  const { onProgress, onSuccess, onError, planId } = options;

  try {
    // Step 1: Get a signed upload URL from our API

    const signedUrlResponse = await getSignedUploadUrl(
      file.name,
      file.type,
      file.size,
      isScheduled,
      planId
    );
    if (!signedUrlResponse.success) {
      const errorMessage =
        signedUrlResponse.message ??
        signedUrlResponse.error ??
        "Failed to get upload URL";
      onError?.(new Error(errorMessage));
      return {
        success: false,
        message: errorMessage,
      };
    }

    const { uploadUrl, path } = signedUrlResponse;
    if (!uploadUrl || !path) {
      const errorMessage = "Invalid upload URL received from server";
      onError?.(new Error(errorMessage));
      return { success: false, message: errorMessage };
    }
    // Step 2: Upload the file directly to Supabase Storage using the signed URL
    //console.log(`[Signed URL] Starting upload to path: ${path}`);
    // Use XMLHttpRequest for progress tracking
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round(
            (event.loaded / event.total) * 100
          );
          console.log(`[Signed URL] Upload progress: ${percentComplete}%`);
          onProgress?.(percentComplete);
        }
      });

      // Handle success
      xhr.addEventListener("load", () => {
        /* console.log(
          `[Signed URL] Upload response: Status ${xhr.status}, Response: ${xhr.responseText}`
        );*/

        if (xhr.status >= 200 && xhr.status < 300) {
          console.log(`[Signed URL] Upload complete: ${path}`);
          onSuccess?.(path!);
          resolve({ success: true, path: path! });
        } else {
          const errorMessage =
            xhr.status === 413
              ? "File too large or storage limit exceeded"
              : "Upload failed. Please try again.";
          onError?.(new Error(errorMessage));
          resolve({ success: false, message: errorMessage });
        }
      });

      // Handle errors
      xhr.addEventListener("error", () => {
        const errorMessage =
          "Upload failed due to network error. Please check your connection and try again.";
        onError?.(new Error(errorMessage));
        resolve({ success: false, message: errorMessage });
      });

      xhr.addEventListener("abort", () => {
        const errorMessage = "Upload was cancelled. Please try again.";
        onError?.(new Error(errorMessage));
        resolve({ success: false, message: errorMessage });
      });

      // Start the upload
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.send(file);
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    onError?.(new Error(errorMessage));
    return { success: false, message: errorMessage }; // ✅ Consistent
  }
}
