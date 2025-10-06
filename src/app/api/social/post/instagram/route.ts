import { directPostForInstagramAccounts } from "@/lib/api/instagram/post/directPostForInstagramAccounts";

export async function POST(request: Request) {
  try {
    const config = await request.json();

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
