import "server-only";

/**
 * Escape HTML entities for safe interpolation into HTML body/attribute context.
 * Use this for text inside <h1>, <p>, <body>, etc.
 *
 * NOT safe for use inside <script> JS string literals. Use toJsString() there.
 */
export function escapeHtml(str: string | null | undefined): string {
  if (str === null || str === undefined) {
    return "";
  }
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serialize a string as a safe JavaScript string literal for interpolation
 * into inline <script> blocks. Adds quotes automatically, escapes control
 * characters, backslashes, quotes, and unicode line separators (U+2028/U+2029).
 *
 * Usage in template:
 *   `<script>fn(${toJsString(userInput)})</script>`
 *
 * NOT `fn("${toJsString(userInput)}")` (toJsString already includes quotes).
 */
export function toJsString(str: string | null | undefined): string {
  // JSON.stringify handles quotes, backslashes, control chars, and unicode.
  // We additionally escape U+2028 and U+2029 which are valid JSON but break
  // JS parsers when used inside <script> blocks.
  // We also escape </ to prevent </script> breakout.
  return JSON.stringify(str ?? "")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/<\/(?=\s*script)/gi, "<\\/");
}
