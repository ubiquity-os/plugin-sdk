/**
 * Options for cleanMarkdown.
 *
 * tags:
 *   A single list of HTML tag names (keyof HTMLElementTagNameMap) to remove.
 *   Behavior per tag:
 *     1. If an HTML block token consists solely of a single root element whose tag matches, the entire block (its content) is removed.
 *        (e.g. <details> ... </details> when "details" is in tags).
 *     2. Standalone inline occurrences of that tag treated as void/self-closing (e.g. <br>) are stripped.
 *
 * collapseEmptyLines:
 *   If true, collapses sequences of 3+ blank lines down to exactly 2, preserving paragraph spacing while shrinking payload size.
 */
type Options = { tags?: string[]; shouldCollapseEmptyLines?: boolean };

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/**
 * Cleans a GitHub-flavored markdown string by:
 *  - Removing top‑level HTML comments (<!-- ... -->) (outside code / inline code / blockquote context)
 *  - Removing blocks for configured tags when the entire html token is a single element of that tag
 *  - Removing inline occurrences of configured tags treated as void (e.g. \<br\>) outside fenced / inline code
 *  - Preserving comments and tags inside:
 *       * fenced or indented code blocks
 *       * inline code spans
 *       * blockquotes (their contents unchanged)
 *  - Optionally collapsing excessive blank lines
 */
export function cleanMarkdown(md: string, options: Options = {}): string {
  const codeBlockRegex = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
  const { tags = [], shouldCollapseEmptyLines = false } = options;

  const segments: string[] = [];
  let lastIndex = 0;

  const matches = [...md.matchAll(codeBlockRegex)];
  for (const match of matches) {
    if (match.index > lastIndex) {
      segments.push(processSegment(md.slice(lastIndex, match.index), tags, shouldCollapseEmptyLines));
    }
    segments.push(match[0]); // keep code blocks untouched
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < md.length) {
    segments.push(processSegment(md.slice(lastIndex), tags, shouldCollapseEmptyLines));
  }

  return segments.join("");
}

function processSegment(segment: string, extraTags: string[], shouldCollapseEmptyLines: boolean): string {
  // Protect inline code
  const inlineCodeRegex = /`[^`]*`/g;
  const inlineCodes: string[] = [];
  let s = segment.replace(inlineCodeRegex, (m) => {
    inlineCodes.push(m);
    return `__INLINE_CODE_${inlineCodes.length - 1}__`;
  });

  // Remove HTML comments
  s = s.replace(/<!--[\s\S]*?-->/g, "");

  // Remove extra tags
  for (const raw of extraTags) {
    if (!raw) continue;
    const tag = raw
      .toLowerCase()
      .trim()
      .replace(/[^\w:-]/g, ""); // allow web components / namespaces
    if (!tag) continue;

    if (VOID_TAGS.has(tag)) {
      // Remove <tag> or <tag ... /> (case-insensitive)
      const voidRe = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
      s = s.replace(voidRe, "");
      continue;
    }

    // Remove paired tags and their contents; repeat to handle nesting
    const pairRe = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    let prev: string;
    do {
      prev = s;
      s = s.replace(pairRe, "");
    } while (s !== prev);

    // If any stray/open/close remnants remain, drop the tags themselves
    const openCloseRe = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    s = s.replace(openCloseRe, "");
  }

  // Restore inline code
  s = s.replace(/__INLINE_CODE_(\d+)__/g, (str, idx) => inlineCodes[+idx]);

  if (shouldCollapseEmptyLines) {
    s = s
      // eslint-disable-next-line sonarjs/slow-regex
      .replace(/[ \t]+$/gm, "") // trim trailing spaces
      .replace(/\n{3,}/g, "\n\n"); // collapse 3+ newlines to 2
  }

  return s;
}
