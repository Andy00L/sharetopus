import { adminSupabase } from "@/actions/api/adminSupabase";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  console.log(`[Media Proxy] Incoming signed request: ${request.url}`);

  // Extract parameters (already validated in verifySignature)
  const filePath = decodeURIComponent(searchParams.get("file") || "");
  const userId = decodeURIComponent(searchParams.get("user") || "");

  if (!filePath || !userId) {
    console.warn("[Media Proxy] Missing required parameters");
    return new Response("Missing parameters", {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  // 🛡️ SECURITY CHECK 2: Path Validation (defense in depth)
  if (
    filePath.includes("..") ||
    filePath.includes("//") ||
    filePath.startsWith("/")
  ) {
    console.warn(`[Media Proxy] Blocked suspicious file path: ${filePath}`);
    return new Response("Invalid file path", {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    console.log(
      `[Media Proxy] Processing request for file: ${filePath}, user: ${userId}`
    );

    const { data, error } = await adminSupabase.storage
      .from("scheduled-videos")
      .createSignedUrl(filePath, 600); // 10 minutes

    if (error) {
      console.error("[Media Proxy] Supabase error:", error);

      // Handle specific error cases
      if (
        error.message.includes("not found") ||
        error.message.includes("404")
      ) {
        return new Response("File not found", {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Failed to create signed URL", {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!data?.signedUrl) {
      console.error("[Media Proxy] No signed URL returned from Supabase");
      return new Response("File not found", {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`[Media Proxy] Redirecting to Supabase signed URL`);

    return Response.redirect(data.signedUrl, 302);
  } catch (error) {
    console.error("[Media Proxy] Unexpected error:", error);
    return new Response("Internal server error", {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
