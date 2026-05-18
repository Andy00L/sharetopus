/**
 * Octopus brand mark. Eight orange arms radiating from a center dot.
 * Purely decorative (aria-hidden). Sized via the `size` prop.
 *
 * @param size - SVG width and height in pixels (default 32).
 * @param color - Stroke and fill color. Defaults to the marketing --orange token.
 */
export function Octopus({
  size = 32,
  color = "var(--orange, #FF5A36)",
}: {
  size?: number;
  color?: string;
}) {
  const arms = 8;
  const cx = 50;
  const cy = 50;
  const inner = 8;
  const outer = 36;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="block"
    >
      {Array.from({ length: arms }).map((_, i) => {
        const angle = (i * 2 * Math.PI) / arms - Math.PI / 2;
        const x1 = cx + Math.cos(angle) * inner;
        const y1 = cy + Math.sin(angle) * inner;
        const x2 = cx + Math.cos(angle) * outer;
        const y2 = cy + Math.sin(angle) * outer;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={cx} cy={cy} r="9" fill={color} />
    </svg>
  );
}
