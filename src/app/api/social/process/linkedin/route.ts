import { processLinkedinAccounts } from "@/lib/api/linkedin/processAccounts/processLinkedinAccounts";

export async function POST(request: Request) {
  try {
    const config = await request.json();

    const result = await processLinkedinAccounts(config);

    return Response.json(result);
  } catch (error) {
    console.error("[API Process LinkedIn] Unexpected error:", error);

    // Improved error message with more context
    const errorMessage =
      error instanceof Error
        ? `LinkedIn processing failed: ${error.message}`
        : "LinkedIn processing encountered an unexpected error";

    return Response.json(
      {
        successCount: 0,
        errors: [
          {
            accountId: "server-error",
            platform: "linkedin",
            displayName: "LinkedIn API",
            error: errorMessage,
          },
        ],
      },
      { status: 500 }
    );
  }
}
