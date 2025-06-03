import { authCheck } from "@/actions/authCheck";
import { directPostForTikTokAccounts } from "@/components/core/create/action/Direct/directPostForTikTokAccounts";

export async function POST(request: Request) {
  try {
    const config = await request.json();

    // Authentication check
    const authResult = await authCheck(config.userId, {
      isCronJob: config.isCronJob,
      cronSecret: process.env.CRON_SECRET_KEY,
    });

    if (!authResult) {
      console.error(
        `[API Post Tiktok]: Authentication failed for user: ${config.userId}`
      );
      return Response.json(
        {
          success: false,
          count: 0,
          message: "Authentication failed. Please sign in again.",
        },
        { status: 401 }
      );
    }

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
