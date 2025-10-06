import { processTiktokAccounts } from "@/lib/api/tiktok/processAccounts/processTiktokAccounts";

export async function POST(request: Request) {
  try {
    const config = await request.json();

    const result = await processTiktokAccounts(config);

    return Response.json(result);
  } catch (error) {
    console.error("[API Process Tiktok] Unexpected error:", error);

    // Improved error message with more context
    const errorMessage =
      error instanceof Error
        ? `Tiktok processing failed: ${error.message}`
        : "Tiktok processing encountered an unexpected error";

    return Response.json(
      {
        successCount: 0,
        errors: [
          {
            accountId: "server-error",
            platform: "Tiktok",
            displayName: "Tiktok API",
            error: errorMessage,
          },
        ],
      },
      { status: 500 }
    );
  }
}
