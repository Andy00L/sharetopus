# MCP Server

Model Context Protocol server for Sharetopus at `/api/mcp/mcp`. AI clients (Claude, Cursor, ChatGPT)
publish and schedule posts on a subscriber's connected accounts.

## Auth paths

1. **API key**: Bearer token starting with `stp_mcp_`, hashed with SHA-256 and matched against
   `api_keys.token_hash` (`auth/resolvers/apiKey.ts`).
2. **Clerk OAuth**: the client discovers the auth server through
   `/.well-known/oauth-protected-resource` (RFC 9728), runs Clerk's OAuth 2.1 flow, and sends the
   access token on every request (`auth/resolvers/oauth.ts`).

Both paths resolve to an `McpPrincipal` that every tool handler receives.

## Entitlement model

Every tool requires the Creator plan or higher (`ACTION_PLAN_GATE` in `entitlement.ts`);
`applySubscriptionGate` rejects lower plans before any tool runs. `publish_posts`,
`attach_media_from_url` and `request_upload_url` carry 500 calls a month on Creator
(`MONTHLY_CAPS`); Pro has no cap.

## File layout

- `auth/`: principal resolution (API key or Clerk OAuth) and the OAuth client trust check
- `entitlement.ts`: plan gate and monthly quotas
- `withMcpTool.ts`: the wrapper every tool runs through (auth, entitlement, rate limit, audit)
- `audit.ts`: append-only `mcp_audit_log` writer
- `serverInstructions.ts`: the guide sent to every client at initialize
- `tools/`: 10 tool handlers, one per file
- `prompts/`: 3 prompt templates

## Adding a tool

1. Create a file in `tools/` named after the tool and export `register<Name>(server)`.
2. Add it to `TOOL_REGISTRARS` in `tools/index.ts` and its name to `toolNames.ts`.
3. Add the name to `ACTION_PLAN_GATE` in `entitlement.ts` (the compiler enforces it), and to
   `MONTHLY_CAPS` when it has a monthly cap.
4. Add its summary to `MCP_TOOL_DOCS` in `src/lib/docs/mcpCatalog.ts`.
