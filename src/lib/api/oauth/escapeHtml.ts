import "server-only";

// The script data state decodes no character references, so this output is not
// safe inside <script>; toJsString is:
// https://html.spec.whatwg.org/multipage/parsing.html#script-data-state
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

export function toJsString(str: string | null | undefined): string {
  // U+2028 and U+2029 end a string literal in engines older than ES2019:
  // https://tc39.es/proposal-json-superset/
  // "</script" inside a script element closes it:
  // https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
  return JSON.stringify(str ?? "")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/<\/(?=\s*script)/gi, "<\\/");
}
