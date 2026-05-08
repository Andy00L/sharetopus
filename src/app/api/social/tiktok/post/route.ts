import { authCheckCronJob } from "@/actions/server/authCheckCronJob";
import { directPostForTikTokAccounts } from "@/lib/api/tiktok/post/directPostForTikTokAccounts";

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

    const result = await directPostForTikTokAccounts(body);
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
