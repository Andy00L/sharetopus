// lib/client/getSignedViewUrl.ts
export interface SignedViewUrlResponse {
  success: boolean;
  url: string;
  error?: string;
}

export async function getSignedViewUrl(
  path: string,
  expiresIn: number = 1800 // 30 minutes by default
): Promise<SignedViewUrlResponse> {
  try {
    const response = await fetch("/api/storage/generate-view-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path,
        expiresIn,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "Failed to generate view URL");
    }

    return data;
  } catch (error) {
    console.error("[Signed View URL] Error:", error);
    throw error;
  }
}
