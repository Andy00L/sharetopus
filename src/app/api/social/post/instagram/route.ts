import { authCheck } from "@/actions/authCheck";
import { directPostForInstagramAccounts } from "@/components/core/create/action/Direct/directPostForInstagramAccounts";

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
        `[API Post Instagram]: Authentication failed for user: ${config.userId}`
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

    const result = await directPostForInstagramAccounts(config);
    return Response.json(result);
  } catch (error) {
    console.error("[API Post Instagram] Unexpected error:", error);

    const errorMessage =
      error instanceof Error
        ? `Instagram posting failed: ${error.message}`
        : "Instagram posting encountered an unexpected error";

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
