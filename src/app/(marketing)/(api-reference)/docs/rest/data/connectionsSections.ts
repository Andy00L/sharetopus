import type {
  DocsSection,
  ParamTableData,
} from "@/lib/docs/apiReferenceTypes";

/**
 * Connections resource of the /docs/rest reference. Field lists mirror
 * src/lib/api/rest/validation/connectionSchemas.ts (read in full) and the
 * ConnectionDTO factory.
 */

const CONNECTION_DTO_FIELDS: ParamTableData = {
  heading: "Response Fields (ConnectionDTO)",
  rows: [
    {
      name: "id",
      type: "string (uuid)",
      required: true,
      description: "Account id, used as social_account_id when posting.",
    },
    {
      name: "platform",
      type: "string",
      required: true,
      description:
        "linkedin, tiktok, pinterest, instagram, facebook, threads, youtube, or x.",
    },
    {
      name: "account_identifier",
      type: "string",
      required: true,
      description: "Platform-side account identifier.",
    },
    {
      name: "display_name",
      type: "string | null",
      required: true,
      description: "Profile display name.",
    },
    {
      name: "username",
      type: "string | null",
      required: true,
      description: "Profile handle.",
    },
    {
      name: "avatar_url",
      type: "string | null",
      required: true,
      description: "Profile image URL.",
    },
    {
      name: "is_verified",
      type: "boolean | null",
      required: true,
      description: "Platform verification badge, when known.",
    },
    {
      name: "follower_count",
      type: "number | null",
      required: true,
      description: "Follower count at last sync.",
    },
    {
      name: "is_available",
      type: "boolean",
      required: true,
      description: "False when the platform token expired; use reauth.",
    },
    {
      name: "token_expires_at",
      type: "string | null",
      required: true,
      description: "Platform token expiry, when the platform reports one.",
    },
    {
      name: "created_at",
      type: "string",
      required: true,
      description: "When the account was connected.",
    },
  ],
};

export const REST_CONNECTIONS_SECTION: DocsSection = {
  id: "connections",
  navLabel: "Connections",
  title: "Connections",
  summary:
    "Connected social accounts. OAuth flows are browser-based: the API returns an authorization URL, the user finishes in the browser, and the account appears in the list. Platform tokens are never returned.",
  sourceRef:
    "src/app/api/v1/connections/route.ts, connections/initiate/route.ts, connections/[id]/route.ts, connections/[id]/reauth/route.ts, connections/[id]/boards/route.ts, src/lib/api/rest/validation/connectionSchemas.ts",
  operations: [
    {
      id: "connections-list",
      method: "GET",
      path: "/api/v1/connections",
      title: "List connections",
      description:
        "Cursor-paginated list of connected accounts. By default only available accounts are returned; include_unavailable=true adds accounts whose platform token expired (candidates for reauth).",
      sourceRef:
        "src/app/api/v1/connections/route.ts, connectionSchemas.ts (ConnectionListQuerySchema)",
      paramTables: [
        {
          heading: "Query Parameters",
          rows: [
            {
              name: "platform",
              type: "string",
              required: false,
              description:
                "Any of linkedin, tiktok, pinterest, instagram, facebook, threads, youtube, x.",
            },
            {
              name: "include_unavailable",
              type: "boolean",
              required: false,
              description: "true to include expired accounts. Default false.",
            },
            {
              name: "limit",
              type: "number",
              required: false,
              description: "1 to 100. Default 20.",
            },
            {
              name: "cursor",
              type: "string",
              required: false,
              description: "next_cursor from the previous page.",
            },
          ],
        },
        CONNECTION_DTO_FIELDS,
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl "https://sharetopus.com/api/v1/connections?include_unavailable=true" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "connections-initiate",
      method: "POST",
      path: "/api/v1/connections/initiate",
      title: "Initiate an OAuth connection",
      description:
        "Starts an OAuth flow for a new account. Open connect_url in a browser; after the user authorizes, the provider redirects to the Sharetopus callback and the account becomes visible in List connections. The state expires after 15 minutes.",
      sourceRef:
        "src/app/api/v1/connections/initiate/route.ts, connectionSchemas.ts (ConnectionInitiateInputSchema)",
      paramTables: [
        {
          heading: "Request Body",
          rows: [
            {
              name: "platform",
              type: "string",
              required: true,
              description:
                "linkedin, tiktok, pinterest, instagram, youtube, x, or facebook.",
            },
            {
              name: "redirect_url",
              type: "string (url)",
              required: false,
              description:
                "Custom OAuth redirect URI. Defaults to the Sharetopus callback.",
            },
          ],
        },
        {
          heading: "Response Fields",
          rows: [
            {
              name: "connect_url",
              type: "string",
              required: true,
              description: "Authorization URL to open in a browser.",
            },
            {
              name: "state",
              type: "string",
              required: true,
              description: "OAuth state token bound to this attempt.",
            },
            {
              name: "expires_at",
              type: "string",
              required: true,
              description: "15 minutes after creation.",
            },
            {
              name: "connection_id",
              type: "string (uuid)",
              required: true,
              description: "Id of the pending connection row.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X POST "https://sharetopus.com/api/v1/connections/initiate" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "platform": "youtube" }'`,
        },
      ],
    },
    {
      id: "connections-get",
      method: "GET",
      path: "/api/v1/connections/{id}",
      title: "Get a connection",
      description:
        "Returns one connected account by id. Accounts owned by another principal return 404.",
      sourceRef: "src/app/api/v1/connections/[id]/route.ts",
      paramTables: [
        {
          heading: "Path Parameters",
          rows: [
            {
              name: "id",
              type: "string (uuid)",
              required: true,
              description: "Connection id.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl "https://sharetopus.com/api/v1/connections/5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "connections-reauth",
      method: "POST",
      path: "/api/v1/connections/{id}/reauth",
      title: "Reauthorize a connection",
      description:
        "For an account whose platform token expired (is_available false). Returns a fresh authorization URL to open in a browser, plus the current account snapshot.",
      sourceRef: "src/app/api/v1/connections/[id]/reauth/route.ts",
      paramTables: [
        {
          heading: "Response Fields",
          rows: [
            {
              name: "reauth_url",
              type: "string",
              required: true,
              description: "Authorization URL to open in a browser.",
            },
            {
              name: "account",
              type: "ConnectionDTO",
              required: true,
              description: "The account being reauthorized.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X POST "https://sharetopus.com/api/v1/connections/5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d/reauth" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "connections-boards",
      method: "GET",
      path: "/api/v1/connections/{id}/boards",
      title: "List Pinterest boards",
      description:
        "Boards of a connected Pinterest account, for the pinterest_board_id field when posting. 400 when the account is not Pinterest; 401 with a reauth_url when the Pinterest token expired and could not be refreshed.",
      sourceRef:
        "src/app/api/v1/connections/[id]/boards/route.ts, connectionSchemas.ts (PinterestBoardsQuerySchema)",
      paramTables: [
        {
          heading: "Query Parameters",
          rows: [
            {
              name: "page_size",
              type: "number",
              required: false,
              description: "1 to 100. Default 25.",
            },
            {
              name: "bookmark",
              type: "string",
              required: false,
              description:
                "Pinterest pagination bookmark from the previous response.",
            },
          ],
        },
        {
          heading: "Response Fields (data[])",
          rows: [
            {
              name: "id",
              type: "string",
              required: true,
              description: "Board id, used as pinterest_board_id.",
            },
            { name: "name", type: "string", required: true, description: "Board name." },
            {
              name: "description",
              type: "string | null",
              required: true,
              description: "Board description.",
            },
            {
              name: "privacy",
              type: "string | null",
              required: true,
              description: "Board privacy setting.",
            },
            {
              name: "pin_count",
              type: "number | null",
              required: true,
              description: "Pins on the board.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl "https://sharetopus.com/api/v1/connections/5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d/boards?page_size=25" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
  ],
};
