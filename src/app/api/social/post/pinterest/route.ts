import { directPostForPinterestAccounts } from "@/lib/api/pinterest/post/directPostForPinterestAccounts";

export async function POST(request: Request) {
  try {
    const config = await request.json();

    const result = await directPostForPinterestAccounts(config);
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
