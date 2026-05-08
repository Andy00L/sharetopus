import { authCheckCronJob } from "@/actions/server/authCheckCronJob";
import { directPostForLinkedInAccounts } from "@/lib/api/linkedin/post/directPostForLinkedInAccounts";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const authResult = await authCheckCronJob(body.userId ?? null, body.cronSecret);
    if (!authResult) {
      return Response.json(
        { success: false, count: 0, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const result = await directPostForLinkedInAccounts(body);
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
