// app/api/auth/tiktok/callback/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeTikTokCode, getTikTokUserInfo } from "@/lib/tiktok/auth";
import { Provider } from "@/actions/types/provider";
import { upsertSocialAccount } from "@/actions/server/supabase/upsertSocialAccount";
import { auth } from "@clerk/nextjs/server";

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/tiktok/callback/close?error=unauthorized`
      );
    }

    // Parse query parameters
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Check for errors from TikTok
    if (error) {
      console.error("TikTok OAuth error:", error);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/tiktok/callback/close?error=tiktok_auth_failed`
      );
    }

    // Validate required parameters
    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/tiktok/callback/close?error=missing_params`
      );
    }

    // Verify state parameter to prevent CSRF
    const storedState = (await cookies()).get("tiktok_auth_state")?.value;
    if (state !== storedState) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/tiktok/callback/close?error=invalid_state`
      );
    }

    // Clear the state cookie
    (await cookies()).set({
      name: "tiktok_auth_state",
      value: "",
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });

    // Exchange code for access token
    const tokenData = await exchangeTikTokCode(code);

    // Get user profile information
    const userInfo = await getTikTokUserInfo(tokenData.access_token);

    // Save the TikTok account to database using your existing function
    await upsertSocialAccount(
      userId,
      "tiktok" as Provider,
      {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        scope: tokenData.scope,
        user_id: tokenData.open_id,
      },
      {
        provider_account_id: userInfo.open_id,
        username: userInfo.display_name,
        display_name: userInfo.display_name,
        avatar_url: userInfo.avatar_url,
      }
    );

    // Redirect to success page - changement ici pour rediriger vers la page de fermeture
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/tiktok/callback/close?success=tiktok_connected`
    );
  } catch (error) {
    console.error("Error handling TikTok callback:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/tiktok/callback/close?error=callback_error`
    );
  }
}
