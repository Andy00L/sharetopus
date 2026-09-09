# Sharetopus UI design system (per-project sheet)

The single source of truth for visual work on public surfaces. Values are
extracted from the existing marketing theme (src/app/globals.css,
`.marketing-theme` scope), never invented. Components read tokens (CSS
variables or the shadcn mappings), never literals.

## Field and palette

| Role | Token | Value | Rule |
|---|---|---|---|
| Field (page) | `--cream` / `bg-background` | `#F3F4EF` | Committed warm paper. Never flat white pages. |
| Layered field | `--cream-2` / `bg-accent` | `#E9EAE4` | Section bands, subtle fills, pills. |
| Card | `--card` | `#FFFFFF` | White cards float on the cream field. |
| Ink | `--ink` / `text-foreground` | `#1C1B18` | Titles, primary text, dark bands. |
| Ink 2 | `--ink-2` | `#4A4845` | Body copy (`t-body`), descriptions. |
| Muted | `--muted` / `text-muted-foreground` | `#8B8A85` | Meta text and labels only; fails 4.5:1 for body, never body copy. |
| Line | `--line` `#D6D5CF`, `--line-2` / `border-border` `#E0E1DB` | | Hairlines. |
| Accent | `--orange` / `text-primary` | `#FF5A36` (deep `--orange-2` `#E84A26`) | The only saturated color. Interactive states, eyebrows, one spark per screen. NEVER on backgrounds. |
| Destructive | `--destructive` | root oklch red | Errors and destructive semantics only (DELETE badge, terminal states). |

## Type

- One face: DM Sans (`--font-dm-sans`), weights 400 to 800.
- Precise face: Geist Mono via `font-mono` (paths, params, code, prices).
- Role utilities in globals.css: `t-eyebrow` (12px, 0.18em tracking, uppercase,
  orange), `t-body` (16px, ink-2), `font-display` (800, -0.035em).
- Docs scale: H1 `text-4xl font-display`, H2 `text-2xl font-bold
  tracking-tight`, body 15px ink-2, tables 12 to 13px, code 13px mono.

## Space and shape

- Radius: `--radius` 10px base; cards `rounded-xl`, chips `rounded-lg`,
  pills `rounded-full`.
- Content max width 80rem (`max-w-7xl`); section rhythm py-8/py-10;
  card padding p-4.

## Depth and material

- One material: white card + `border-border` hairline. Elevation ladder:
  hairline only (tables, code) -> `--shadow-soft` (hero surfaces) ->
  `--shadow-hard` (`6px 6px 0 0 var(--ink)`, the signature stamp, once per
  page). Never two shadow treatments on the same elevation level.
- Dark surface: `--ink` background + cream text (the marketing CTA-band
  recipe). Used for code cards.

## Motion tokens

- Durations: 150ms (hover/color), 200ms (small moves), 300ms ceiling.
- Easing: Tailwind default `ease-out` on enters; color transitions via
  `transition-colors`. No layout-property animation.
- Reduced motion: interactions are color/opacity-only; nothing to disable.

## Signature element

The **ink stamp**: exactly one artifact per reference page carries
`shadow-[var(--shadow-hard)]` + a `border-foreground` border, marking the
page's hero artifact. Placement rule, one per page: x402 -> the 402 payment
quote card; REST -> the authenticated quickstart request card; MCP -> the
client configuration card. Domain-grounded (a printed receipt/stamp: pay per
action), token-built, never two per page.

## The API reference family (docs/x402, docs/rest, docs/mcp)

- Structure: breadcrumb, eyebrow (`t-eyebrow`) + display title + ink-2
  subtitle, chip row (mono, white card chips), sticky scroll-spy sidebar
  (lg+), horizontal pill TOC (below lg), sections split two-column at xl
  (prose left, code right).
- Sidebar active state: 2px orange left rail + `font-semibold` ink on
  `--cream-2` fill (orange text alone fails contrast on cream).
- Method badges (mono, labeled): GET `--cream-2` fill; POST ink fill +
  cream text; PATCH white fill + hairline; DELETE destructive tint.
- Param tables: mono ink names; required = small bold ink "required",
  optional = muted; zebra rows white / cream 60%.
- Callouts: warning = orange 8% fill + orange 25% hairline + ink-2 text;
  note = cream-2 60% fill + hairline + ink-2 text. No blue anywhere.
- Code cards: ink surface, cream-2 code text, muted uppercase label bar,
  copy button fades in on hover.

## The Solana proof ledger (/solana)

- Structure: marketing nav and footer, then a 64rem (`max-w-5xl`) column:
  eyebrow + display title + ink-2 subtitle, a chip row of the real lane
  facts (CAIP-2 id, USDC mint, payTo; mono, white card chips), the latest
  receipt beside the way-in code card, then the ledger table.
- Signature placement: the **latest receipt** card carries the ink stamp
  (`border-foreground` + `shadow-[var(--shadow-hard)]`) and the page's one
  bespoke silhouette, a torn receipt edge (a 12px sawtooth in the card
  color over the field). Never a second stamp on this page; the code card
  stays unfeatured.
- Outcome marks: a 6px dot plus a word, never a pill. Published = solid
  ink; in progress (publishing, scheduled, not linked) = hollow muted ring;
  failed and refunded = solid destructive; cancelled = hollow destructive.
  One map, `src/components/solana/OutcomeMark.tsx`.
- Ledger table: the PricingTable recipe (white card, hairline, cream-2
  head, zebra rows); signatures and addresses truncated in the middle
  (8 + 8, 4 + 4) in `font-mono tabular-nums` with the full value in
  `title`; time in UTC.
- Explorer links (`src/components/solana/ExplorerLink.tsx`): mono ink
  text with the orange up-right arrow; hover and focus underline in
  orange; focus ring 2px orange, offset 2. Orange text at 12px is 3.1:1 on
  white and never carries a link label. Platform slugs and fact labels sit
  in ink-2, not muted (muted is 3.5:1 on white).
- Width: 64rem is a recorded exception to the 80rem docs width. A ledger
  reads better on a shorter measure.

## Dashboard surfaces (protected app)

The dashboard runs on the shadcn token set (`:root` zinc scale) over the
cream field (`.protected-theme` background `#F3F4EF`), Geist Sans/Mono,
white `bg-card` panels with `border-border` hairlines. Rules the calendar
and composer preview established, for every future dashboard surface:

- Accent: `--chart-1` (burnt orange oklch) is the dashboard's one spark,
  already the create-card hover accent. It marks today's date chip, the
  week view's now line, and drop-target highlights. Never a second
  saturated color at rest.
- Status colors live in one map:
  `src/components/core/scheduled/statusStyles.ts` (badge text/border +
  solid dot per status). Every surface showing post status reads it.
- Platform glyphs live in one registry:
  `src/components/icons/platformBrandIcons.tsx` (legacy inline SVGs +
  Tabler brand icons + letter-badge fallback). No local icon maps.
- Grid material: hairline cells via `gap-px` over `bg-border` inside a
  `rounded-xl border` shell (calendar month and week grids).
- Motion: 150ms color/opacity transitions only; drag feedback is a
  `shadow-lg` overlay clone plus a dimmed (opacity-40) source chip.
- Time is always `font-mono` + `tabular-nums`.

## House style, one line

Warm paper, precise ink, one orange spark: a printed field guide that
machines can also read.
