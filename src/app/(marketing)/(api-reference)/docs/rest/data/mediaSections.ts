import type { DocsSection } from "@/lib/docs/apiReferenceTypes";

/**
 * Media resource of the /docs/rest reference. Field lists mirror
 * src/lib/api/rest/validation/mediaSchemas.ts (read in full); behavior
 * notes mirror the route handlers.
 */

export const REST_MEDIA_SECTION: DocsSection = {
  id: "media",
  navLabel: "Media",
  title: "Media",
  summary:
    "Upload media before creating image or video posts, either by direct upload (signed URL) or by importing from a public URL. Storage paths are account-scoped: every path starts with your principal id.",
  sourceRef:
    "src/app/api/v1/media/upload-url/route.ts, media/attach-from-url/route.ts, media/[...path]/route.ts, src/lib/api/rest/validation/mediaSchemas.ts",
  operations: [
    {
      id: "media-upload-url",
      method: "POST",
      path: "/api/v1/media/upload-url",
      title: "Create an upload URL",
      description:
        "Returns a signed URL for a direct upload. PUT the file bytes to upload_url, then use storage_path as media_storage_path when creating posts. Content type and size are validated against your plan limits; 403 when the storage quota would be exceeded.",
      sourceRef:
        "src/app/api/v1/media/upload-url/route.ts, mediaSchemas.ts (UploadUrlInputSchema)",
      paramTables: [
        {
          heading: "Request Body",
          rows: [
            {
              name: "filename",
              type: "string",
              required: true,
              description: "1 to 255 characters.",
            },
            {
              name: "content_type",
              type: "string",
              required: true,
              description: "MIME type of the file, for example video/mp4.",
            },
            {
              name: "size_bytes",
              type: "number",
              required: true,
              description: "Positive integer.",
            },
          ],
        },
        {
          heading: "Response Fields",
          rows: [
            {
              name: "upload_url",
              type: "string",
              required: true,
              description: "Signed upload URL.",
            },
            {
              name: "storage_path",
              type: "string",
              required: true,
              description: "Path to use as media_storage_path when posting.",
            },
            {
              name: "token",
              type: "string",
              required: true,
              description: "Upload token bound to the signed URL.",
            },
            {
              name: "expires_in_seconds",
              type: "number",
              required: true,
              description: "Signed URL lifetime: 7200 (2 hours).",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X POST "https://sharetopus.com/api/v1/media/upload-url" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "filename": "launch.mp4", "content_type": "video/mp4", "size_bytes": 10485760 }'`,
        },
      ],
    },
    {
      id: "media-attach-from-url",
      method: "POST",
      path: "/api/v1/media/attach-from-url",
      title: "Attach media from a URL",
      description:
        "Downloads media from a public URL into Sharetopus storage server-side. SSRF-protected (private address ranges are blocked) and restricted to image and video content types. The filename is inferred from the URL when omitted.",
      sourceRef:
        "src/app/api/v1/media/attach-from-url/route.ts, mediaSchemas.ts (AttachFromUrlInputSchema)",
      paramTables: [
        {
          heading: "Request Body",
          rows: [
            {
              name: "url",
              type: "string (url)",
              required: true,
              description: "Public URL of the media file.",
            },
            {
              name: "filename",
              type: "string",
              required: false,
              description: "1 to 255 characters. Inferred from the URL when omitted.",
            },
          ],
        },
        {
          heading: "Response Fields",
          rows: [
            {
              name: "success",
              type: "boolean",
              required: true,
              description: "True when the file was stored.",
            },
            {
              name: "storage_path",
              type: "string",
              required: true,
              description: "Path to use as media_storage_path when posting.",
            },
            {
              name: "content_type",
              type: "string",
              required: true,
              description: "Detected MIME type.",
            },
            {
              name: "size_bytes",
              type: "number",
              required: true,
              description: "Stored file size.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X POST "https://sharetopus.com/api/v1/media/attach-from-url" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "url": "https://example.com/assets/launch.mp4" }'`,
        },
      ],
    },
    {
      id: "media-view-url",
      method: "GET",
      path: "/api/v1/media/{path}",
      title: "Get a view URL",
      description:
        "Returns a short-lived signed URL to view or download a stored file. The path is the full storage path ({principal_id}/filename); paths outside your account return 403.",
      sourceRef:
        "src/app/api/v1/media/[...path]/route.ts (GET), mediaSchemas.ts (ViewUrlQuerySchema)",
      paramTables: [
        {
          heading: "Query Parameters",
          rows: [
            {
              name: "expires_in_seconds",
              type: "number",
              required: false,
              description: "1 to 3600. Default 300.",
            },
          ],
        },
        {
          heading: "Response Fields",
          rows: [
            {
              name: "view_url",
              type: "string",
              required: true,
              description: "Signed view URL.",
            },
            {
              name: "expires_in_seconds",
              type: "number",
              required: true,
              description: "Lifetime of the returned URL.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl "https://sharetopus.com/api/v1/media/user_2f6a1c0e.../launch.mp4?expires_in_seconds=600" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "media-delete",
      method: "DELETE",
      path: "/api/v1/media/{path}",
      title: "Delete a media file",
      description:
        "Reference-aware delete: when the file is still referenced by a scheduled or pending post, it is preserved and the response carries deleted false. Unreferenced files are removed.",
      sourceRef: "src/app/api/v1/media/[...path]/route.ts (DELETE)",
      paramTables: [
        {
          heading: "Response Fields",
          rows: [
            {
              name: "storage_path",
              type: "string",
              required: true,
              description: "The path acted on.",
            },
            {
              name: "deleted",
              type: "boolean",
              required: true,
              description: "False when the file is still referenced by a post.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X DELETE "https://sharetopus.com/api/v1/media/user_2f6a1c0e.../launch.mp4" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
  ],
};
