/**
 * Sanitizes rich-text HTML produced by the diary editor.
 *
 * The editor only ever emits a whitelist of formatting tags, but imported
 * backups or pasted content could contain anything — so every write path
 * funnels through this sanitizer. Scripts, event handlers and unknown tags
 * are removed; formatting (H1–H5, lists, checklists, links, quotes) is preserved.
 */

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "del",
  "strike",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "a",
  "span",
  "input",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel", "class"]),
  ol: new Set(["type", "start", "style", "class"]),
  ul: new Set(["style", "class", "data-list-style"]),
  li: new Set(["style", "class", "data-checked"]),
  input: new Set(["type", "checked", "disabled", "class"]),
  span: new Set(["class", "style"]),
};

/** A comment or construct that must never survive sanitization. */
const DANGEROUS_PATTERN =
  /<\s*(script|iframe|object|embed|style|link|meta)[\s>]|on\w+\s*=/i;

export function sanitizeHtml(input: string): string {
  if (!input) return "";

  let html = String(input);

  // Fast rejection of obviously malicious payloads.
  if (DANGEROUS_PATTERN.test(html)) {
    html = html.replace(
      /<\s*(script|iframe|object|embed|style|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
      "",
    );
    html = html.replace(
      /<\s*(script|iframe|object|embed|style|link|meta)\b[^>]*\/?>/gi,
      "",
    );
    html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  }

  // Remove any tag that is not in the whitelist, keeping its text content.
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)>/g, (match, tag: string, attrs: string) => {
    const lower = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return "";
    if (match.startsWith("</")) return `</${lower}>`;

    const allowed = ALLOWED_ATTRS[lower];
    let cleanAttrs = "";
    let hasTargetBlank = false;
    let hasRel = false;

    if (allowed && attrs) {
      const attrRe = /([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrs)) !== null) {
        const name = m[1].toLowerCase();
        let value = m[2];

        // Strip quotes for inspection
        const unquoted = value.replace(/^["']|["']$/g, "");

        if (allowed.has(name)) {
          if (name === "href") {
            // Reject dangerous schemes
            if (/^\s*(javascript:|data:|vbscript:)/i.test(unquoted)) {
              continue;
            }
            if (!/^(https?:|mailto:|\/|#)/i.test(unquoted.trim())) {
              continue;
            }
          }

          if (name === "target" && unquoted === "_blank") {
            hasTargetBlank = true;
          }

          if (name === "rel") {
            hasRel = true;
            value = '"noopener noreferrer"';
          }

          if (name === "style") {
            // Only allow safe list styling or display rules
            const safeStyle = unquoted
              .split(";")
              .filter((rule) => {
                const [prop] = rule.split(":").map((s) => s.trim().toLowerCase());
                return prop === "list-style-type" || prop === "list-style";
              })
              .join("; ");
            if (!safeStyle) continue;
            value = `"${safeStyle}"`;
          }

          cleanAttrs += ` ${name}=${value}`;
        }
      }
    }

    if (lower === "a" && hasTargetBlank && !hasRel) {
      cleanAttrs += ' rel="noopener noreferrer"';
    }

    return `<${lower}${cleanAttrs}>`;
  });

  // Strip javascript: style hrefs defensively one more time.
  html = html.replace(/href\s*=\s*("|')?\s*(javascript:|data:|vbscript:)[^"'>\s]*("|')?/gi, 'href="#"');

  return html;
}
