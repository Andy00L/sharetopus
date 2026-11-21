import { adminSupabase } from "@/actions/api/adminSupabase";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";
import { isOwnedMediaPath } from "@/lib/storage/mediaPath";
import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

const UPSTREAM_HEADERS_TIMEOUT_MS = 15_000;
const SIGNED_URL_TTL_SECONDS = 600;

async function fetchUpstreamWithHeadersTimeout(signedUrl: string): Promise<Response> {
  const headersAbortController = new AbortController();
  const headersTimer = setTimeout(
    () => headersAbortController.abort(),
    UPSTREAM_HEADERS_TIMEOUT_MS,
  );
  try {
    return await fetch(signedUrl, { signal: headersAbortController.signal });
  } finally {
    clearTimeout(headersTimer);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const filePath = searchParams.get("file") ?? "";
  const userId = searchParams.get("user") ?? "";
  const expiresRaw = searchParams.get("expires") ?? "";
  const sig = searchParams.get("sig") ?? "";

  console.log("[GET /api/media] Incoming request", {
    user: userId,
    file: filePath,
  });

  if (!filePath || !userId || !expiresRaw || !sig) {
    console.warn("[GET /api/media] Missing required parameters");
    return new Response("Missing required parameters", {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const expires = parseInt(expiresRaw, 10);
  if (Number.isNaN(expires) || Math.floor(Date.now() / 1000) >= expires) {
    console.warn("[GET /api/media] URL expired", { user: userId, file: filePath });
    return new Response("URL expired", {
      status: 410,
      headers: { "Content-Type": "application/json" },
    });
  }

  const secret = process.env.MEDIA_PROXY_HMAC_SECRET;
  if (!secret) {
    console.error("[GET /api/media] HMAC secret not configured");
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
    console.warn("[GET /api/media] Signature mismatch", {
      user: userId,
      file: filePath,
    });
    return new Response("Invalid signature", {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isOwnedMediaPath(filePath, userId)) {
    console.warn("[GET /api/media] Path does not belong to user", {
      user: userId,
      file: filePath,
    });
    return new Response("Invalid file path", {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log("[GET /api/media] Signature verified", {
    user: userId,
    file: filePath,
  });

  try {
    const { data, error } = await adminSupabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

    if (error) {
      console.error("[GET /api/media] Supabase error:", error);

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
      console.error("[GET /api/media] No signed URL returned from Supabase");
      return new Response("File not found", {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("[GET /api/media] Streaming file from Supabase signed URL");

    // TikTok's PULL_FROM_URL media URL "should not redirect to another URL", so
    // the bytes are streamed instead of redirected:
    // https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
    let upstream: Response;
    try {
      upstream = await fetchUpstreamWithHeadersTimeout(data.signedUrl);
    } catch (fetchErr) {
      console.error("[GET /api/media] Upstream fetch failed:", fetchErr);
      return new Response("Upstream fetch failed", {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!upstream.ok) {
      console.error(`[GET /api/media] Upstream returned ${upstream.status}`);
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
      console.error("[GET /api/media] Upstream response has no body");
      return new Response("Upstream returned empty body", {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const responseHeaders: Record<string, string> = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };

    const contentType = upstream.headers.get("content-type") ?? "";

    if (/^image\//i.test(contentType)) {
      const { fitPhotoForTikTok } = await import(
        "@/lib/api/tiktok/fitPhotoForTikTok"
      );
      const fitResult = await fitPhotoForTikTok(
        Buffer.from(await upstream.arrayBuffer()),
      );
      if (!fitResult.ok) {
        return new Response(fitResult.message, {
          status: 422,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return new Response(new Uint8Array(fitResult.bytes), {
        status: 200,
        headers: {
          ...responseHeaders,
          "Content-Type": "image/jpeg",
          "Content-Length": String(fitResult.bytes.length),
        },
      });
    }

    if (/^video\//i.test(contentType)) {
      responseHeaders["Content-Type"] = contentType;
    } else {
      responseHeaders["Content-Type"] = "application/octet-stream";
      responseHeaders["Content-Disposition"] = "attachment";
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
    console.error("[GET /api/media] Unexpected error:", error);
    return new Response("Internal server error", {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
