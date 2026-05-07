import {
  protectedResourceHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next";

/**
 * RFC 9728 Protected Resource Metadata endpoint.
 *
 * MCP clients (Claude Desktop, Cursor, etc.) hit this URL during OAuth
 * discovery to find the Clerk authorization server for Sharetopus.
 * The handler reads NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY from env and
 * returns the correct metadata JSON.
 *
 * Called by: MCP clients during OAuth 2.1 discovery
 * External dep: @clerk/mcp-tools
 */
const handler = protectedResourceHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
