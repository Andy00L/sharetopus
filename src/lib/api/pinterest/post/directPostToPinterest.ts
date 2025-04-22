"use server";

import { adminSupabase } from "@/actions/api/supabase-client";
import { getSupabaseVideoFile } from "@/actions/server/scheduleActions/getSupabaseVideoFile";
import { createPinterestPinFromBase64 } from "@/lib/api/pinterest/post/createPinterestPin";

interface DirectPostParams {
  userId: string;
  accountId: string;
  boardId: string;
  imagePath: string;
  title: string;
  description?: string;
  link?: string;
}

export async function directPostToPinterest(
  params: DirectPostParams
): Promise<{ success: boolean; message: string; pinId?: string }> {
  try {
    if (!params.userId) {
      return { success: false, message: "User not authenticated." };
    }

    // Validate input
    if (
      !params.accountId ||
      !params.boardId ||
      !params.imagePath ||
      !params.title
    ) {
      return { success: false, message: "Missing required information." };
    }

    // Get the Pinterest account
    const { data: account, error: accountError } = await adminSupabase
      .from("social_accounts")
      .select("access_token")
      .eq("id", params.accountId)
      .eq("user_id", params.userId)
      .eq("platform", "pinterest")
      .single();

    if (accountError || !account) {
      console.error("[Pinterest] Account retrieval error:", accountError);
      return {
        success: false,
        message: "Failed to retrieve Pinterest account.",
      };
    }

    // Get the image file from Supabase
    const imageBuffer = await getSupabaseVideoFile(
      params.imagePath,
      params.userId
    );

    // Convert buffer to base64
    const base64Data = imageBuffer.toString("base64");

    // Determine content type based on file extension
    const contentType = params.imagePath.toLowerCase().endsWith(".png")
      ? "image/png"
      : params.imagePath.toLowerCase().endsWith(".gif")
      ? "image/gif"
      : "image/jpeg";

    // Post the pin to Pinterest
    const response = await createPinterestPinFromBase64(
      account.access_token,
      params.boardId,
      base64Data,
      contentType,
      {
        title: params.title,
        description: params.description,
        link: params.link,
      }
    );

    return {
      success: true,
      message: "Pin successfully posted to Pinterest.",
      pinId: response.id,
    };
  } catch (error) {
    console.error("[Pinterest] Direct post error:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to post Pin to Pinterest.",
    };
  }
}
