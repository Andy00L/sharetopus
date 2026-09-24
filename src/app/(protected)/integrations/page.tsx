import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { listRestApiKeys } from "@/actions/server/api/listRestApiKeys";
import { listApiKeys } from "@/actions/server/mcp/listApiKeys";
import { InactiveSubscriptionNotice } from "@/components/InactiveSubscriptionNotice";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { ApiKeysCard } from "./components/ApiKeysCard";
import { McpDocsCard } from "./components/McpDocsCard";
import { RestApiKeysCard } from "./components/RestApiKeysCard";

/**
 * Integrations page for managing MCP and REST API keys.
 *
 * Server component. Checks for an active subscription before rendering
 * the key management UI. Users without a plan see the subscribe prompt, and
 * a failed check shows a retry (InactiveSubscriptionNotice), as on
 * src/app/(protected)/connections/page.tsx.
 *
 * Route: /integrations (protected)
 * Server actions used: checkActiveSubscription, listApiKeys, listRestApiKeys
 */
export default async function IntegrationsPage() {
  const { userId } = await auth();

  const sub = await checkActiveSubscription(userId ?? null);
  if (!sub.isActive) {
    return <InactiveSubscriptionNotice status={sub.status} />;
  }

  const [mcpKeysResult, restKeysResult] = await Promise.all([
    listApiKeys(userId ?? null),
    listRestApiKeys(userId ?? null),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <SidebarContent className="px-4 py-6">
        <SidebarGroup className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
            <p className="text-muted-foreground">
              Connect AI assistants and custom applications to Sharetopus.
            </p>
          </div>
        </SidebarGroup>
      </SidebarContent>
      <ApiKeysCard initialKeys={mcpKeysResult.data ?? []} />
      <RestApiKeysCard initialKeys={restKeysResult.data ?? []} />
      <McpDocsCard />
    </div>
  );
}
