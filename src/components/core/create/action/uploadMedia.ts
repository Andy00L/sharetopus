import { uploadWithSignedUrl } from "@/lib/client/signedUrlUpload";

export async function uploadMedia(file: File): Promise<string> {
  console.log("Uploading media file...");
  try {
    const path = await uploadWithSignedUrl(file, {
      onProgress: (progress) => console.log(`Upload progress: ${progress}%`),
      onSuccess: (path) => console.log("File uploaded successfully:", path),
      onError: (error) => {
        throw error;
      },
    });
    console.log("Media uploaded to:", path);
    return path;
  } catch (error) {
    console.error("Upload error:", error);
    throw new Error(`Media upload failed: ${error}`);
  }
}
