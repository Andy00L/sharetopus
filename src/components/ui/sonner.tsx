"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps } from "sonner";

/** Sonner's own CSS variables mapped to the app's popover tokens. */
const TOASTER_STYLE: React.CSSProperties & Record<`--${string}`, string> = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
};

/** next-themes reports any string; Sonner takes light, dark or system. */
function toToasterTheme(theme: string): ToasterProps["theme"] {
  return theme === "light" || theme === "dark" ? theme : "system";
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={toToasterTheme(theme)}
      className="toaster group"
      style={TOASTER_STYLE}
      {...props}
    />
  );
};

export { Toaster };
