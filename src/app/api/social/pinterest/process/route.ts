import { authCheckCronJob } from "@/actions/server/authCheckCronJob";
import { processPinterestAccounts } from "@/lib/api/pinterest/processAccounts/processPinterestAccounts";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const authResult = await authCheckCronJob(body.userId ?? null, body.cronSecret);
    if (!authResult) {
      return Response.json(
        {
          successCount: 0,
          errors: [
            {
              accountId: "server-error",
              platform: "Pinterest",
              displayName: "Pinterest API",
              error: "Unauthorized",
            },
          ],
        },
        { status: 401 }
      );
    }

    const result = await processPinterestAccounts(body);

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
