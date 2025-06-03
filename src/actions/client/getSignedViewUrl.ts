// lib/client/getSignedViewUrl.ts

export interface SignedViewUrlResponse {
  success: boolean;
  url?: string;
  message: string;
}

export async function getSignedViewUrl(
  path: string,
  requestUserId: string,
  expiresIn: number = 300
): Promise<SignedViewUrlResponse> {
  try {
    const response = await fetch(
      "https://sharetopus.com/api/storage/generate-view-url",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path,
          expiresIn,
          requestUserId,
        }),
      }
    );
    const data = await response.json();

    if (!response.ok) {
      console.log(data.error ?? "Failed to generate view URL");
      return { success: false, message: "Failed to generate view URL" };
    }

    return {
      success: true,
      url: data.url,
      message: "Succesfully got the signed url",
    };
  } catch (error) {
    console.error("[Signed View URL] Error:", error);
    return { success: false, message: "Unecpected error" };
  }
}
