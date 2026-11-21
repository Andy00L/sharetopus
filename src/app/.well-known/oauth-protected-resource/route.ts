import {
  protectedResourceHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next";

// RFC 9728 section 3 (https://www.rfc-editor.org/rfc/rfc9728) fixes this path for
// OAuth protected resource metadata; MCP clients read it during OAuth discovery.
const handler = protectedResourceHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
