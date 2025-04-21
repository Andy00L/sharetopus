// lib/client/signedUrlUpload.ts

/**
 * Type for the response from the generate-upload-url API
 */
export interface SignedUrlResponse {
  success: boolean;
  uploadUrl: string;
  path: string;
  token: string;
  error?: string;
}

/**
 * Options for the uploadWithSignedUrl function
 */
export interface UploadOptions {
  onProgress?: (progress: number) => void;
  onSuccess?: (path: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Request a signed upload URL from the server
 */
export async function getSignedUploadUrl(
  filename: string,
  contentType: string,
  bucketName: string = "scheduled-videos"
): Promise<SignedUrlResponse> {
  try {
    console.log("[Signed URL] Requesting URL for:", {
      filename,
      contentType,
      bucketName,
    });

    const response = await fetch("/api/storage/generate-upload-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename,
        contentType,
        bucketName,
      }),
    });

    const data = await response.json();
    console.log("[Signed URL] API response:", data);

    if (!response.ok) {
      throw new Error(data.error ?? "Failed to generate upload URL");
    }

    return data;
  } catch (error) {
    console.error("[Signed URL] Error getting signed URL:", error);
    throw error;
  }
}

/**
 * Upload a file using a signed URL
 */
export async function uploadWithSignedUrl(
  file: File,
  options: UploadOptions = {}
): Promise<string> {
  const { onProgress, onSuccess, onError } = options;

  try {
    // Step 1: Get a signed upload URL from our API
    console.log(
      `[Signed URL] Requesting signed URL for file: ${file.name} (${file.type})`
    );
    const { uploadUrl, path } = await getSignedUploadUrl(file.name, file.type);

    // Step 2: Upload the file directly to Supabase Storage using the signed URL
    console.log(`[Signed URL] Uploading file using signed URL`);
    console.log(`[Signed URL] Starting upload to path: ${path}`);
    // Use XMLHttpRequest for progress tracking
    return new Promise((resolve, reject) => {
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
        console.log(
          `[Signed URL] Upload response: Status ${xhr.status}, Response: ${xhr.responseText}`
        );

        if (xhr.status >= 200 && xhr.status < 300) {
          console.log(`[Signed URL] Upload complete: ${path}`);
          onSuccess?.(path);
          resolve(path);
        } else {
          const error = new Error(`Upload failed with status: ${xhr.status}`);
          onError?.(error);
          reject(error);
        }
      });

      // Handle errors
      xhr.addEventListener("error", () => {
        const error = new Error("Network error during upload");
        onError?.(error);
        reject(error);
      });

      xhr.addEventListener("abort", () => {
        const error = new Error("Upload aborted");
        onError?.(error);
        reject(error);
      });

      // Start the upload
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.send(file);
    });
  } catch (error) {
    console.error("[Signed URL] Upload error:", error);
    onError?.(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
