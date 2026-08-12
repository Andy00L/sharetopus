"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

/**
 * Light/dark toggle for the dashboard header. Both icons render and CSS
 * decides visibility (`dark:` classes), the standard SSR-safe pattern:
 * no mounted-state effect, no hydration mismatch. resolvedTheme is only
 * read inside the click handler, which cannot fire before mount.
 */
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
