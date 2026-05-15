import Link from "next/link";

const docsNav = [
  { title: "Quickstart", href: "/docs/quickstart" },
  { title: "Authentication", href: "/docs/authentication" },
  { title: "Webhooks", href: "/docs/webhooks" },
  { title: "API Reference", href: "/docs/api" },
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
        <ul className="space-y-2">
          {docsNav.map((item) => (
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
      </nav>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
