"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

/**
 * next-themes wrapper. attribute="class" stamps `.dark` on <html>, which
 * globals.css tokens key off. Marketing pages stay light regardless: the
 * .marketing-theme scope re-defines every token on its own element.
 * next-themes persists the choice itself (its own localStorage key), which
 * is inherent to a theme toggle: one that resets every load is broken.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
