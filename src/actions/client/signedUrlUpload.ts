export interface SignedUrlResponse {
  success: boolean;
  uploadUrl?: string;
  path?: string;
  token?: string;
  error?: string;
  message?: string;
}

export interface UploadOptions {
  onProgress?: (progress: number) => void;
  onSuccess?: (path: string) => void;
  onError?: (error: Error) => void;
}

export async function getSignedUploadUrl(
  filename: string,
  contentType: string,
  fileSize: number,
  isScheduled: boolean
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
        isScheduled,
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
    console.error("[getSignedUploadUrl] Error getting signed URL:", error);
    return {
      success: false,
      error: "Connection error",
      message: "Failed to connect to upload service. Please try again.",
    };
  }
}

export async function uploadWithSignedUrl(
  file: File,
  isScheduled: boolean,
  options: UploadOptions = {}
): Promise<{ success: boolean; path?: string; message?: string }> {
  const { onProgress, onSuccess, onError } = options;

  try {
    const signedUrlResponse = await getSignedUploadUrl(
      file.name,
      file.type,
      file.size,
      isScheduled,
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
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round(
            (event.loaded / event.total) * 100
          );
          onProgress?.(percentComplete);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          console.log(`[uploadWithSignedUrl] Upload complete: ${path}`);
          onSuccess?.(path);
          resolve({ success: true, path });
        } else {
          const errorMessage =
            xhr.status === 413
              ? "File too large or storage limit exceeded"
              : "Upload failed. Please try again.";
          onError?.(new Error(errorMessage));
          resolve({ success: false, message: errorMessage });
        }
      });

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

      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.send(file);
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    onError?.(new Error(errorMessage));
    return { success: false, message: errorMessage };
  }
}
