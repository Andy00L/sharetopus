import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  console.log(`[Media Proxy] Incoming signed request: ${request.url}`);

  // Extract parameters (already validated in verifySignature)
  const filePath = decodeURIComponent(searchParams.get("file")!);
  const userId = decodeURIComponent(searchParams.get("user")!);

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
