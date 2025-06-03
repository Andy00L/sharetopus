import { authCheck } from "@/actions/authCheck";
import { directPostForLinkedInAccounts } from "@/components/core/create/action/Direct/directPostForLinkedInAccounts";

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
        `[API Post LinkedIn]: Authentication failed for user: ${config.userId}`
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

    const result = await directPostForLinkedInAccounts(config);
    return Response.json(result);
  } catch (error) {
    console.error("[API Post LinkedIn] Unexpected error:", error);

    const errorMessage =
      error instanceof Error
        ? `LinkedIn posting failed: ${error.message}`
        : "LinkedIn posting encountered an unexpected error";

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
