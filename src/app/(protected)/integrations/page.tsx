import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { listRestApiKeys } from "@/actions/server/api/listRestApiKeys";
import { listApiKeys } from "@/actions/server/mcp/listApiKeys";
import { InactiveSubscriptionNotice } from "@/components/InactiveSubscriptionNotice";
import { ApiKeysCard } from "@/components/integrations/ApiKeysCard";
import { McpDocsCard } from "@/components/integrations/McpDocsCard";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";

/** /integrations: MCP and REST API key management for subscribed users. */
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
      <ApiKeysCard kind="mcp" initialKeys={mcpKeysResult.data ?? []} />
      <ApiKeysCard kind="rest" initialKeys={restKeysResult.data ?? []} />
      <McpDocsCard />
    </div>
  );
}
