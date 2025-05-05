// Add this function to a new file called `videoThumbnail.ts` or similar
export function extractVideoThumbnail(videoFile: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      reject(new Error("Cannot get canvas context"));
      return;
    }

    video.preload = "metadata";
    video.src = URL.createObjectURL(videoFile);

    // When video metadata is loaded
    video.onloadedmetadata = () => {
      // Seek to a specific time (e.g., 1 second in) for a better thumbnail
      video.currentTime = Math.min(1, video.duration * 0.1); // 10% of duration or 1 second, whichever is less
    };

    // When the video seeks to the desired time
    video.onseeked = () => {
      // Set canvas dimensions to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Draw the current frame to canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create thumbnail blob"));
          }

          // Clean up
          URL.revokeObjectURL(video.src);
        },
        "image/jpeg",
        0.8
      ); // 80% quality JPEG
    };

    video.onerror = () => {
      reject(new Error("Failed to load video"));
      URL.revokeObjectURL(video.src);
    };
  });
}

// Optional: Create a File from the Blob for easier handling
export async function createVideoThumbnail(videoFile: File): Promise<File> {
  const thumbnailBlob = await extractVideoThumbnail(videoFile);
  return new File([thumbnailBlob], `${videoFile.name}-thumbnail.jpg`, {
    type: "image/jpeg",
  });
}
