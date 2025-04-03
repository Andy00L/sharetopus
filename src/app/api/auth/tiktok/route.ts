// app/api/auth/tiktok/route.ts
import { NextResponse } from "next/server";
import { generateTikTokAuthUrl } from "@/lib/tiktok/auth";
import { cookies } from "next/headers";
import { nanoid } from "nanoid";

export async function GET() {
  try {
    // Generate a CSRF state token
    const state = nanoid();

    // Store the state in a cookie for verification in the callback
    (
      await // Store the state in a cookie for verification in the callback
      cookies()
    ).set({
      name: "tiktok_auth_state",
      value: state,
      httpOnly: true,
      path: "/",
      maxAge: 60 * 10, // 10 minutes
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    // Generate the TikTok authorization URL
    const { url } = generateTikTokAuthUrl(state);

    // Redirect the user to TikTok's authorization page
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("Error initializing TikTok auth:", error);
    return NextResponse.json(
      { error: "Failed to initialize TikTok authorization" },
      { status: 500 }
    );
  }
}
