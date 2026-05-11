# _internal server actions

These are stripped-down versions of the public server actions in the parent
directory. They skip the Clerk `authCheck()` call because the caller (the
MCP route handler) has already verified the principal's identity.

Rate limiting is handled by the MCP tool handlers (in `src/lib/mcp/tools/`),
not by these _internal actions. Tools that rate-limit use an `mcp_<action>`
key prefix (e.g. `mcp_attach_media_from_url`) so MCP traffic does not contend
with web UI traffic for the same Upstash bucket.

Do not import these from client components or page-level server actions.
They are for internal consumption by the MCP tool handlers only.
