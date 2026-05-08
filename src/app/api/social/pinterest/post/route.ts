import { authCheckCronJob } from "@/actions/server/authCheckCronJob";
import { directPostForPinterestAccounts } from "@/lib/api/pinterest/post/directPostForPinterestAccounts";

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

    const result = await directPostForPinterestAccounts(body);
    return Response.json(result);
  } catch (error) {
    console.error("[API Post pinterest] Unexpected error:", error);

    const errorMessage =
      error instanceof Error
        ? `pinterest posting failed: ${error.message}`
        : "pinterest posting encountered an unexpected error";

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
