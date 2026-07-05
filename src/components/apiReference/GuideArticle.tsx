/**
 * Shell for the MDX guide pages (/docs/quickstart, /docs/authentication,
 * /docs/webhooks): the eyebrow + measure of the reference family around
 * MDX content styled by src/mdx-components.tsx. `slug` links the page's
 * markdown twin served at /docs/<slug>.md for agents and CLI tools.
 */
export function GuideArticle({
  eyebrow,
  slug,
  children,
}: {
  eyebrow: string;
  slug: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="t-eyebrow">{eyebrow}</p>
        <a
          href={`/docs/${slug}.md`}
          className="rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          view as markdown
        </a>
      </div>
      {children}
    </article>
  );
}
