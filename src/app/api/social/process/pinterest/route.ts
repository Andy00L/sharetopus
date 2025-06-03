import { processPinterestAccounts } from "@/components/core/create/action/processAccounts/processPinterestAccounts";

export async function POST(request: Request) {
  try {
    const config = await request.json();

    const result = await processPinterestAccounts(config);

    return Response.json(result);
  } catch (error) {
    console.error("[API Process Pinterest] Unexpected error:", error);

    // Improved error message with more context
    const errorMessage =
      error instanceof Error
        ? `Pinterest processing failed: ${error.message}`
        : "Pinterest processing encountered an unexpected error";

    return Response.json(
      {
        successCount: 0,
        errors: [
          {
            accountId: "server-error",
            platform: "Pinterest",
            displayName: "Pinterest API",
            error: errorMessage,
          },
        ],
      },
      { status: 500 }
    );
  }
}
