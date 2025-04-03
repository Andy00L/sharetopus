"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Check if the current path is a marketing route
  const isMarketingPage =
    pathname === "/" || pathname.startsWith("/(marketing)");

  return (
    <NextThemesProvider
      attribute="class"
      enableSystem
      disableTransitionOnChange
      forcedTheme={isMarketingPage ? "light" : undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
