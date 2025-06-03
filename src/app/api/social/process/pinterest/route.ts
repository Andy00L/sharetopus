import { authCheck } from "@/actions/authCheck";
import { processPinterestAccounts } from "@/components/core/create/action/processAccounts/processPinterestAccounts";

export async function POST(request: Request) {
  try {
    const config = await request.json();

    const authResult = await authCheck(config.userId, {
      isCronJob: config.isCronJob,
      cronSecret: process.env.CRON_SECRET_KEY,
    });

    if (!authResult) {
      console.error(
        `[API Process Pinterest]: Authentication failed for user: ${config.userId}`
      );
      return Response.json(
        {
          successCount: 0,
          errors: [
            {
              accountId: "auth",
              platform: "system",
              displayName: "Authentication",
              error: "Authentication failed. Please sign in again.",
            },
          ],
        },
        { status: 401 }
      );
    }
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
