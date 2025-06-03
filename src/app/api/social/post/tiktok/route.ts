import { directPostForTikTokAccounts } from "@/components/core/create/action/Direct/directPostForTikTokAccounts";

export async function POST(request: Request) {
  try {
    const config = await request.json();

    const result = await directPostForTikTokAccounts(config);
    return Response.json(result);
  } catch (error) {
    console.error("[API Post Tiktok] Unexpected error:", error);

    const errorMessage =
      error instanceof Error
        ? `Tiktok posting failed: ${error.message}`
        : "Tiktok posting encountered an unexpected error";

    return Response.json(
      {
        success: false,
        count: 0,
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}
