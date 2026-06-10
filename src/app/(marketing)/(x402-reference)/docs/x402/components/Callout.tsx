// Two callout tones from the design contract: amber for warnings (real
// money, key handling), blue for notes (idempotent behaviors, hints).
const TONE_CLASSES = {
  amber:
    "bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800",
  blue: "bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 mt-4",
} as const;

export function Callout({
  tone,
  children,
}: {
  tone: keyof typeof TONE_CLASSES;
  children: React.ReactNode;
}) {
  return <div className={TONE_CLASSES[tone]}>{children}</div>;
}
