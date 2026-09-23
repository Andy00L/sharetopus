import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  MCP_CLAUDE_CODE_NEXT_STEP,
  MCP_CLAUDE_CONNECT_STEPS,
  buildClaudeCodeAddCommand,
  buildMcpClientConfigJson,
} from "@/lib/docs/mcpCatalog";

/**
 * Static instructions for connecting an MCP client to Sharetopus: Claude
 * (custom connector), Claude Code, Cursor, and other MCP clients. The steps
 * come from the shared MCP catalog, so they match /docs/mcp; this card
 * passes its own origin for the URLs.
 *
 * Called by: src/app/(protected)/integrations/page.tsx
 */
export function McpDocsCard() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
  const mcpUrl = `${baseUrl}/api/mcp/mcp`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect an AI client</CardTitle>
        <CardDescription>
          Use the Model Context Protocol to let AI assistants manage your social
          media.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="mb-2 text-sm font-medium">Claude (web and desktop)</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            {MCP_CLAUDE_CONNECT_STEPS}
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {mcpUrl}
          </pre>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Claude Code</h3>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {buildClaudeCodeAddCommand(mcpUrl)}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            {MCP_CLAUDE_CODE_NEXT_STEP}
          </p>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Cursor</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Add this to ~/.cursor/mcp.json, with a key from MCP API Keys above:
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {buildMcpClientConfigJson(mcpUrl)}
          </pre>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Other MCP clients</h3>
          <p className="text-xs text-muted-foreground">
            Point the client at <code>{mcpUrl}</code>. Clients with MCP OAuth
            discovery (RFC 9728) open the sign-in page on their own; the rest
            send <code>Authorization: Bearer stp_mcp_YOUR_KEY</code> on every
            request.
          </p>
        </div>

        <div className="rounded-md border p-3">
          <h3 className="mb-1 text-sm font-medium">Endpoint reference</h3>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="py-1 pr-3 text-muted-foreground">MCP URL</td>
                <td>
                  <code>{mcpUrl}</code>
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3 text-muted-foreground">
                  OAuth metadata
                </td>
                <td>
                  <code>{baseUrl}/.well-known/oauth-protected-resource</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
