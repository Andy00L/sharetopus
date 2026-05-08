/**
 * Converts a PNG file to JPEG with a white background for transparency.
 * Pure browser utility (canvas-based). The caller is responsible for
 * catching errors thrown by this function.
 */
export function convertPngToJpeg(
  file: File,
  quality: number = 1
): Promise<File> {
  return new Promise((resolve, reject) => {
    const MAX_CONVERSION_SIZE = 100 * 1024 * 1024; // 100MB

    if (file.size > MAX_CONVERSION_SIZE) {
      reject(new Error(`Image too large `));
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Canvas context not available"));
      return;
    }
    const img = new Image();

    const timeout = setTimeout(() => {
      reject(new Error("Conversion timeout"));
    }, 10000);

    const cleanup = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(img.src);
    };

    img.onload = () => {
      cleanup();

      try {
        canvas.width = img.width;
        canvas.height = img.height;

        // White background to replace PNG transparency
        ctx!.fillStyle = "white";
        ctx!.fillRect(0, 0, canvas.width, canvas.height);

        ctx!.drawImage(img, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const originalName = file.name;
              const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
              const jpegName = `${nameWithoutExt}.jpg`;

              const jpegFile = new File([blob], jpegName, {
                type: "image/jpeg",
                lastModified: Date.now(),
              });
              resolve(jpegFile);
            } else {
              reject(new Error("Conversion failed"));
            }
          },
          "image/jpeg",
          quality
        );
      } catch (error) {
        reject(
          new Error(
            `Canvas processing failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          )
        );
      }
    };

    img.onerror = () => {
      cleanup();
      reject(
        new Error("Failed to load image. Please try again or try later.")
      );
    };
    try {
      img.src = URL.createObjectURL(file);
    } catch {
      clearTimeout(timeout);
      reject(new Error("Failed to create object URL"));
    }
  });
}
