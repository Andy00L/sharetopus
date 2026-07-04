import "server-only";

/**
 * Canonical public origin of the site, no trailing slash.
 * sourceRef: src/app/layout.tsx (metadataBase)
 */
export const SITE_ORIGIN = "https://sharetopus.com";

/**
 * Escapes a table cell so pipe characters and line breaks cannot break
 * the row layout of a generated markdown table.
 */
function escapeTableCell(cell: string): string {
  return cell.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/**
 * Renders a GitHub-flavored markdown table from a header row and body rows.
 */
export function renderMarkdownTable(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const headerLine = `| ${columns.map(escapeTableCell).join(" | ")} |`;
  const separatorLine = `| ${columns.map(() => "---").join(" | ")} |`;
  const bodyLines = rows.map(
    (row) => `| ${row.map(escapeTableCell).join(" | ")} |`,
  );
  return [headerLine, separatorLine, ...bodyLines].join("\n");
}

/**
 * Picks a fence language hint from the shape of a code sample so agent
 * clients and markdown viewers get sensible syntax highlighting.
 */
function detectFenceLanguage(code: string): string {
  const trimmedCode = code.trimStart();
  if (trimmedCode.startsWith("curl") || trimmedCode.startsWith("#")) {
    return "bash";
  }
  if (trimmedCode.startsWith("{") || trimmedCode.startsWith("[")) {
    return "json";
  }
  if (trimmedCode.startsWith("HTTP/")) {
    return "http";
  }
  return "";
}

/**
 * Renders a fenced code block, with an optional bold label line above it.
 */
export function renderFencedCode(code: string, label?: string): string {
  const fence = "```";
  const block = `${fence}${detectFenceLanguage(code)}\n${code}\n${fence}`;
  return label ? `**${label}**\n\n${block}` : block;
}
