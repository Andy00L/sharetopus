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

    console.log("[Media Proxy] Streaming file from Supabase signed URL");

    // Stream the file body instead of redirecting. TikTok's Content
    // Posting API rejects redirects on PULL_FROM_URL per their docs.
    // Pinterest's S3 ingester also rejects redirects in some configs.
    let upstream: Response;
    try {
      upstream = await fetch(data.signedUrl);
    } catch (fetchErr) {
      console.error("[Media Proxy] Upstream fetch failed:", fetchErr);
      return new Response("Upstream fetch failed", {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!upstream.ok) {
      console.error(
        `[Media Proxy] Upstream returned ${upstream.status}`
      );
      if (upstream.status === 404) {
        return new Response("File not found", {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Upstream error", {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!upstream.body) {
      console.error("[Media Proxy] Upstream response has no body");
      return new Response("Upstream returned empty body", {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const responseHeaders: Record<string, string> = {
      "Cache-Control": "private, no-store",
    };

    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      responseHeaders["Content-Type"] = contentType;
    }

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) {
      responseHeaders["Content-Length"] = contentLength;
    }

    return new Response(upstream.body, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[Media Proxy] Unexpected error:", error);
    return new Response("Internal server error", {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
