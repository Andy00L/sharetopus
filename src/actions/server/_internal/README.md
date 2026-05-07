# _internal server actions

These are stripped-down versions of the public server actions in the parent
directory. They skip the Clerk `authCheck()` call because the caller (the
MCP route handler) has already verified the principal's identity.

Rate limiting uses an `mcp.<action>` scope so MCP traffic does not contend
with web UI traffic for the same Upstash bucket.

Do not import these from client components or page-level server actions.
They are for internal consumption by the MCP tool handlers only.
