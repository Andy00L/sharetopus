import { processInstagramAccounts } from "@/components/core/create/action/processAccounts/processInstagramAccounts";

export async function POST(request: Request) {
  try {
    const config = await request.json();

    const result = await processInstagramAccounts(config);

    return Response.json(result);
  } catch (error) {
    console.error("[API Process Instagram] Unexpected error:", error);

    // Improved error message with more context
    const errorMessage =
      error instanceof Error
        ? `Instagram processing failed: ${error.message}`
        : "Instagram processing encountered an unexpected error";

    return Response.json(
      {
        successCount: 0,
        errors: [
          {
            accountId: "server-error",
            platform: "Instagram",
            displayName: "Instagram API",
            error: errorMessage,
          },
        ],
      },
      { status: 500 }
    );
  }
}
