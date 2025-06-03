import { authCheck } from "@/actions/authCheck";
import { processLinkedinAccounts } from "@/components/core/create/action/processAccounts/processLinkedinAccounts";

export async function POST(request: Request) {
  try {
    const config = await request.json();

    const authResult = await authCheck(config.userId, {
      isCronJob: config.isCronJob,
      cronSecret: process.env.CRON_SECRET_KEY,
    });

    if (!authResult) {
      console.error(
        `[API Process Linkedin]: Authentication failed for user: ${config.userId}`
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
