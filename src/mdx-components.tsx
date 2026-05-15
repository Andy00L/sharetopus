import type { MDXComponents } from "mdx/types";

/**
 * Required by @next/mdx. Provides default component overrides for
 * MDX rendering. Currently passes through defaults; extend here to
 * add custom code blocks, callouts, etc.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...components };
}
