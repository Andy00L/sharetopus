import { DM_Sans } from "next/font/google";

/* Primary marketing typeface. DM Sans covers every role in the typography
   spec. Weights 400-800 plus italic variants. Single source of truth for
   all marketing page text (headings, body, buttons, nav, cards). */
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
});

/* Marketing layout. The .marketing-theme wrapper scopes the
   ReelFarm-matched neutrals palette plus DM Sans typography.
   Protected routes never inherit these tokens. */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${dmSans.variable} marketing-theme min-h-screen bg-background text-foreground antialiased`}
    >
      {children}
    </div>
  );
}
