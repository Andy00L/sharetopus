"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

// next-themes leaves resolvedTheme undefined until mount (node_modules/next-themes/README.md,
// "Avoid Hydration Mismatch"): CSS picks the icon, and only the click handler reads the theme.
export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  function toggleColorTheme() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 cursor-pointer"
      aria-label="Toggle color theme"
      onClick={toggleColorTheme}
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  );
}
