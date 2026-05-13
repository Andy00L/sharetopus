import { adminSupabase } from "@/actions/api/adminSupabase";
import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const filePath = searchParams.get("file") ?? "";
  const userId = searchParams.get("user") ?? "";
  const expiresRaw = searchParams.get("expires") ?? "";
  const sig = searchParams.get("sig") ?? "";

  console.log("[Media Proxy] Incoming request", {
    user: userId,
    file: filePath,
  });

  // SECURITY CHECK 1: All params must be present
  if (!filePath || !userId || !expiresRaw || !sig) {
    console.warn("[Media Proxy] Missing required parameters");
    return new Response("Missing required parameters", {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // SECURITY CHECK 2: Expiry
  const expires = parseInt(expiresRaw, 10);
  if (Number.isNaN(expires) || Math.floor(Date.now() / 1000) >= expires) {
    console.warn("[Media Proxy] URL expired", { user: userId, file: filePath });
    return new Response("URL expired", {
      status: 410,
      headers: { "Content-Type": "application/json" },
    });
  }

  // SECURITY CHECK 3: HMAC signature verification
  const secret = process.env.MEDIA_PROXY_HMAC_SECRET;
  if (!secret) {
    console.error("[Media Proxy] HMAC secret not configured");
    return new Response("Server misconfiguration", {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = `${userId}:${filePath}:${expires}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expected, "hex");

  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    console.warn("[Media Proxy] Signature mismatch", {
      user: userId,
      file: filePath,
    });
    return new Response("Invalid signature", {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // SECURITY CHECK 4: Path ownership (defense in depth)
  if (!filePath.startsWith(`${userId}/`)) {
    console.warn("[Media Proxy] Path does not belong to user", {
      user: userId,
      file: filePath,
    });
    return new Response("Invalid file path", {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // SECURITY CHECK 5: Path traversal prevention
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

  console.log("[Media Proxy] Signature verified", {
    user: userId,
    file: filePath,
  });

  try {
    const { data, error } = await adminSupabase.storage
      .from("scheduled-videos")
      .createSignedUrl(filePath, 600); // 10 minutes

    if (error) {
      console.error("[Media Proxy] Supabase error:", error);

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
      console.error(`[Media Proxy] Upstream returned ${upstream.status}`);
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
