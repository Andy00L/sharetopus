// src/index.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 🛡️ SECURITY CHECK 1: Origin Validation
    const origin = request.headers.get("Origin");
    const referer = request.headers.get("Referer");

    const allowedOrigins = [
      "https://sharetopus.com",
      "https://www.sharetopus.com",
      "https://media.sharetopus.com",
      // Add your Vercel preview URLs if needed
      env.ALLOWED_PREVIEW_DOMAIN, // For staging
    ];

    // Check if request comes from allowed origins
    const isValidOrigin = allowedOrigins.some(
      (allowed) =>
        origin === allowed || (referer && referer.startsWith(allowed))
    );

    if (!isValidOrigin && origin !== null) {
      console.warn(`Blocked request from unauthorized origin: ${origin}`);
      return new Response("Forbidden: Invalid origin", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
    }
    // 🛡️ SECURITY CHECK 2: Valid File Path
    const filePath = url.searchParams.get("file");
    if (!filePath) {
      return new Response("Missing file parameter", {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate file path format (prevent directory traversal)
    if (
      filePath.includes("..") ||
      filePath.includes("//") ||
      filePath.startsWith("/")
    ) {
      console.warn(`Blocked suspicious file path: ${filePath}`);
      return new Response("Invalid file path", {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      // 🔐 Create Supabase signed URL
      const supabaseUrl = env.SUPABASE_URL;
      const supabaseKey = env.SUPABASE_SERVICE_KEY;
      const bucketName = env.SUPABASE_BUCKET_NAME;

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
            expiresIn: 1800, // 30 minutes
          }),
        }
      );

      if (!signedUrlResponse.ok) {
        return new Response("Failed to create signed URL", {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { signedUrl } = await signedUrlResponse.json();

      if (!signedUrl) {
        return new Response("File not found", {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Redirect TikTok to Supabase signed URL
      return Response.redirect(signedUrl, 302);
    } catch (error) {
      console.error("Worker error:", error);
      return new Response("Internal server error", {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
