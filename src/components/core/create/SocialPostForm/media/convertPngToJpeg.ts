const MAX_CONVERSION_SIZE_BYTES = 100 * 1024 * 1024;
const CONVERSION_TIMEOUT_MS = 10_000;
const TRANSPARENCY_FILL_COLOR = "white";

export type PngToJpegConversion =
  | { ok: true; file: File }
  | { ok: false; reason: string };

export function convertPngToJpeg(
  file: File,
  quality: number = 1
): Promise<PngToJpegConversion> {
  return new Promise((resolve) => {
    const fail = (reason: string) => resolve({ ok: false, reason });

    if (file.size > MAX_CONVERSION_SIZE_BYTES) {
      fail("Image too large");
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      fail("Canvas context not available");
      return;
    }
    const img = new Image();

    const timeout = setTimeout(() => {
      fail("Conversion timeout");
    }, CONVERSION_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(img.src);
    };

    img.onload = () => {
      cleanup();

      try {
        canvas.width = img.width;
        canvas.height = img.height;

        ctx.fillStyle = TRANSPARENCY_FILL_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.drawImage(img, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              fail("Conversion failed");
              return;
            }
            const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
            resolve({
              ok: true,
              file: new File([blob], `${nameWithoutExt}.jpg`, {
                type: "image/jpeg",
                lastModified: Date.now(),
              }),
            });
          },
          "image/jpeg",
          quality
        );
      } catch (error) {
        fail(
          `Canvas processing failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    };

    img.onerror = () => {
      cleanup();
      fail("Failed to load image. Please try again or try later.");
    };
    try {
      img.src = URL.createObjectURL(file);
    } catch {
      clearTimeout(timeout);
      fail("Failed to create object URL");
    }
  });
}
