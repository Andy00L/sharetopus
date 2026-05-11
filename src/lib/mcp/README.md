# MCP Server

Model Context Protocol server for Sharetopus. Lets AI clients (Claude Desktop,
Cursor, ChatGPT, etc.) manage social media posts on behalf of authenticated
subscribers.

## Auth paths

1. **API key**: Bearer token starting with `stp_mcp_`. Hashed with SHA-256 and
   matched against `api_keys.token_hash`. Quick DB lookup, no external call.

2. **Clerk OAuth**: Bearer token verified by `@clerk/mcp-tools`. The client
   discovers the auth server via `/.well-known/oauth-protected-resource` (RFC
   9728), goes through Clerk's OAuth 2.1 flow with Dynamic Client Registration,
   and sends the access token on every request.

Both paths resolve to an `McpPrincipal` that is passed to every tool handler.

## Entitlement model

Every tool call checks the user's Stripe subscription plan and monthly usage
quotas before doing any work. Read tools are available on any active plan.
Write tools require Starter+. Advanced tools (bulk schedule, analytics) need
Creator+. AI draft generation needs Pro.

## File layout

- `auth.ts` - principal resolution (API key or Clerk OAuth)
- `entitlement.ts` - plan gating + quota enforcement
- `audit.ts` - append-only mcp_audit_log writer
- `tokens.ts` - API key generation and SHA-256 hashing
- `tools/` - 17 tool handlers, one per file
- `resources/` - 3 MCP resources (scheduled posts, connections, history)
- `prompts/` - 3 MCP prompt templates

## Adding a new tool

1. Create a file in `tools/` named after the action
2. Export a `register<Name>(server)` function
3. Import and call it from `tools/index.ts`
4. Add the action to `entitlement.ts` ACTION_PLAN_GATE with the correct tier
5. If the tool has a monthly cap, add it to MONTHLY_CAPS too
