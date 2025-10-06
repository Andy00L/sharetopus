import { createHmac } from "crypto";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  console.log(`[Media Proxy] Incoming signed request: ${request.url}`);

  // 🔐 SECURITY CHECK 1: HMAC Signature Verification
  const secret = process.env.MEDIA_URL_SECRET;
  if (!secret) {
    console.error("[Media Proxy] MEDIA_URL_SECRET not configured");
    return new Response("Server configuration error", {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!verifySignature(searchParams, secret)) {
    console.warn("[Media Proxy] Invalid or expired signature");
    return new Response("Invalid or expired URL", {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Extract parameters (already validated in verifySignature)
  const filePath = decodeURIComponent(searchParams.get("f")!);
  const userId = decodeURIComponent(searchParams.get("u")!);

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

    // 🔐 Create Supabase signed URL
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY;
    const bucketName = process.env.SUPABASE_BUCKET_NAME;

    if (!supabaseUrl || !supabaseKey) {
      console.error("[Media Proxy] Missing environment variables");
      return new Response("Server configuration error", {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(
      `[Media Proxy] Calling Supabase API: ${supabaseUrl}/storage/v1/object/sign/${bucketName}/${filePath}`
    );

    // Call Supabase Storage API to create signed URL
    const signedUrlResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/sign/${bucketName}/${filePath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expiresIn: 600, // 10 minutes
        }),
      }
    );

    console.log(
      `[Media Proxy] Supabase response status: ${signedUrlResponse.status}`
    );

    if (!signedUrlResponse.ok) {
      const errorText = await signedUrlResponse.text();
      console.error(
        `[Media Proxy] Supabase API error: ${signedUrlResponse.status} - ${errorText}`
      );

      if (signedUrlResponse.status === 404) {
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

    const responseData = await signedUrlResponse.json();
    console.log("[Media Proxy] Supabase response:", responseData);

    const signedPath = responseData.signedURL;

    if (!signedPath) {
      console.error(
        "[Media Proxy] No signedURL in response data:",
        responseData
      );
      return new Response("File not found", {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build full Supabase URL
    const signedUrl = `${supabaseUrl}${signedPath}`;
    console.log(`[Media Proxy] Redirecting to: ${signedUrl}`);

    // 🔄 Redirect to Supabase signed URL
    return Response.redirect(signedUrl, 302);
  } catch (error) {
    console.error("[Media Proxy] Unexpected error:", error);
    return new Response("Internal server error", {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Verifies the HMAC signature of a signed media URL
 * @param searchParams - URL search parameters containing the signature and payload
 * @param secret - HMAC secret from environment variables
 * @returns boolean indicating if signature is valid
 */
function verifySignature(
  searchParams: URLSearchParams,
  secret: string
): boolean {
  try {
    const filePath = searchParams.get("f");
    const userId = searchParams.get("u");
    const exp = searchParams.get("exp");
    const nonce = searchParams.get("n");
    const signature = searchParams.get("sig");

    if (!filePath || !userId || !exp || !nonce || !signature) {
      console.warn(
        "[Media Proxy] Missing required parameters for signature verification"
      );
      return false;
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    const expiration = parseInt(exp);
    if (now > expiration) {
      console.warn(`[Media Proxy] URL expired: ${now} > ${expiration}`);
      return false;
    }

    // Recreate the payload exactly as it was signed
    const payload = `f=${filePath}&u=${userId}&exp=${exp}&n=${nonce}`;

    // Compute expected signature
    const expectedSig = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");

    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSig.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < signature.length; i++) {
      result |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
    }

    return result === 0;
  } catch (error) {
    console.error("[Media Proxy] Signature verification error:", error);
    return false;
  }
}
