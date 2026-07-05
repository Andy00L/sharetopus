import type { MDXComponents } from "mdx/types";

/**
 * Required by @next/mdx. Maps every MDX element onto the brand token
 * sheet (docs/UI_DESIGN_SYSTEM.md) so the guide pages read like the API
 * reference family: ink headings, ink-2 body, orange links, cream-2
 * inline code chips, ink code surfaces, hairline tables. Tailwind
 * preflight strips default element styles, so each element carries its
 * own spacing here.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: (props) => (
      <h1
        className="font-display mb-3 text-4xl text-foreground"
        {...props}
      />
    ),
    h2: (props) => (
      <h2
        className="mb-3 mt-10 border-b border-border pb-2 text-2xl font-bold tracking-tight text-foreground"
        {...props}
      />
    ),
    h3: (props) => (
      <h3
        className="mb-2 mt-8 text-lg font-semibold text-foreground"
        {...props}
      />
    ),
    p: (props) => (
      <p
        className="mb-4 text-[15px] leading-relaxed text-[var(--ink-2)]"
        {...props}
      />
    ),
    a: (props) => (
      <a
        className="font-medium text-[var(--orange-2)] underline-offset-2 transition-colors hover:underline"
        {...props}
      />
    ),
    strong: (props) => (
      <strong className="font-semibold text-foreground" {...props} />
    ),
    ul: (props) => (
      <ul
        className="mb-4 ml-5 list-disc space-y-1.5 text-[15px] leading-relaxed text-[var(--ink-2)] marker:text-muted-foreground"
        {...props}
      />
    ),
    ol: (props) => (
      <ol
        className="mb-4 ml-5 list-decimal space-y-1.5 text-[15px] leading-relaxed text-[var(--ink-2)] marker:text-muted-foreground"
        {...props}
      />
    ),
    code: (props) => (
      <code
        className="rounded bg-[var(--cream-2)] px-1.5 py-0.5 font-mono text-[13px] text-foreground"
        {...props}
      />
    ),
    pre: (props) => (
      <pre
        className="mb-4 overflow-x-auto rounded-xl border border-foreground/90 bg-foreground p-4 font-mono text-[13px] leading-relaxed text-[var(--cream-2)] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit"
        {...props}
      />
    ),
    table: (props) => (
      <div className="mb-4 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm" {...props} />
      </div>
    ),
    th: (props) => (
      <th
        className="border-b border-border bg-[var(--cream-2)]/50 px-3 py-2 text-left font-semibold text-[var(--ink-2)]"
        {...props}
      />
    ),
    td: (props) => (
      <td className="px-3 py-2 text-xs text-[var(--ink-2)]" {...props} />
    ),
    tr: (props) => <tr className="even:bg-[var(--cream)]/60" {...props} />,
    blockquote: (props) => (
      <blockquote
        className="mb-4 rounded-lg border border-border bg-[var(--cream-2)]/60 p-3.5 text-sm text-[var(--ink-2)] [&_p]:mb-0"
        {...props}
      />
    ),
    hr: (props) => <hr className="my-8 border-border" {...props} />,
    ...components,
  };
}
