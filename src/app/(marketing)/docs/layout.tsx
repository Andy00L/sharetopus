import Link from "next/link";

const docsNavGroups = [
  {
    label: "Guides",
    items: [
      { title: "Quickstart", href: "/docs/quickstart" },
      { title: "Authentication", href: "/docs/authentication" },
      { title: "Webhooks", href: "/docs/webhooks" },
    ],
  },
  {
    label: "References",
    items: [
      { title: "REST API", href: "/docs/rest" },
      { title: "x402 API", href: "/docs/x402" },
      { title: "MCP Server", href: "/docs/mcp" },
      { title: "Interactive explorer", href: "/docs/api" },
    ],
  },
];

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <nav className="w-64 shrink-0 border-r border-border bg-card p-6 hidden md:block">
        <Link href="/docs" className="text-lg font-semibold mb-6 block">
          Docs
        </Link>
        {docsNavGroups.map((group) => (
          <div key={group.label} className="mb-6">
            <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </div>
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
