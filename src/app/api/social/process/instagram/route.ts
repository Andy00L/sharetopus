import { authCheck } from "@/actions/authCheck";
import { processInstagramAccounts } from "@/components/core/create/action/processAccounts/processInstagramAccounts";

export async function POST(request: Request) {
  try {
    const config = await request.json();

    const authResult = await authCheck(config.userId, {
      isCronJob: config.isCronJob,
      cronSecret: process.env.CRON_SECRET_KEY,
    });

    if (!authResult) {
      console.error(
        `[API Process Instagram]: Authentication failed for user: ${config.userId}`
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
