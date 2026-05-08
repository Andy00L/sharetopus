import { authCheckCronJob } from "@/actions/server/authCheckCronJob";
import { directPostForInstagramAccounts } from "@/lib/api/instagram/post/directPostForInstagramAccounts";

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

    const result = await directPostForInstagramAccounts(body);
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
