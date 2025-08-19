import { Lexer } from "marked";

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
export interface CleanMarkdownOptions {
  tags?: (keyof HTMLElementTagNameMap)[];
  collapseEmptyLines?: boolean;
}

/**
 * Cleans a GitHub-flavored markdown string by:
 *  - Removing top‑level HTML comments (<!-- ... -->) (outside code / inline code / blockquote context)
 *  - Removing blocks for configured tags when the entire html token is a single element of that tag
 *  - Removing inline occurrences of configured tags treated as void (e.g. <br>) outside fenced / inline code
 *  - Preserving comments and tags inside:
 *       * fenced or indented code blocks
 *       * inline code spans
 *       * blockquotes (their contents unchanged)
 *  - Optionally collapsing excessive blank lines
 *
 * NOTE:
 *  - Uses marked's Lexer (tokenization only) to avoid fragile global regex stripping.
 *  - Conservative: we only remove a block tag when opening and closing tag live in the same HTML token.
 */
export function cleanMarkdown(markdown: string, options: CleanMarkdownOptions = {}): string {
  if (!markdown) return markdown;

  const { tags = [], collapseEmptyLines: shouldCollapseEmptyLines = false } = options;

  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const inlineTagPattern = tagSet.size ? buildInlineTagPattern([...tagSet]) : null;

  const tokens = Lexer.lex(markdown);

  let out = "";
  for (const token of tokens as MarkdownToken[]) {
    out += renderToken(token, tagSet, inlineTagPattern);
  }

  if (shouldCollapseEmptyLines) {
    out = out.replace(/\n{3,}/g, "\n\n");
  }

  return out.trimEnd();
}

interface BaseTokenShape {
  raw?: string;
  text?: string;
}

interface CodeToken extends BaseTokenShape {
  type: "code";
  lang?: string;
}

interface HtmlToken extends BaseTokenShape {
  type: "html";
}

interface ParagraphToken extends BaseTokenShape {
  type: "paragraph";
}

interface TextToken extends BaseTokenShape {
  type: "text";
}

interface BlockquoteToken extends BaseTokenShape {
  type: "blockquote";
  tokens: MarkdownToken[];
}

interface GenericToken extends BaseTokenShape {
  type:
    | "heading"
    | "list"
    | "list_item"
    | "table"
    | "tablerow"
    | "tablecell"
    | "strong"
    | "em"
    | "codespan"
    | "del"
    | "link"
    | "image"
    | "br"
    | "hr"
    | "space"
    | "escape"
    | "def"
    | "paragraph"
    | string;
}

type MarkdownToken = CodeToken | HtmlToken | ParagraphToken | TextToken | BlockquoteToken | GenericToken;

function renderToken(token: MarkdownToken, tagSet: Set<string>, inlineTagPattern: RegExp | null): string {
  switch (token.type) {
    case "code":
      return renderCode(token as CodeToken);
    case "blockquote":
      return renderBlockquote(token as BlockquoteToken);
    case "html":
      return renderHtml(token as HtmlToken, tagSet, inlineTagPattern);
    case "paragraph":
      return renderParagraph(token as ParagraphToken, inlineTagPattern);
    case "text":
      return renderText(token as TextToken, inlineTagPattern);
    default:
      return renderOther(token as GenericToken, inlineTagPattern);
  }
}

function renderCode(token: CodeToken): string {
  if (token.raw) return ensureTrailingNewline(token.raw);
  const fence = "```" + (token.lang || "") + "\n" + (token.text || "") + "\n```";
  return ensureTrailingNewline(fence);
}

function renderBlockquote(token: BlockquoteToken): string {
  if (token.raw) return ensureTrailingNewline(token.raw);
  const inner = token.tokens.map((t) => t.raw ?? t.text ?? "").join("");
  return ensureTrailingNewline(inner);
}

function renderHtml(token: HtmlToken, tagSet: Set<string>, inlineTagPattern: RegExp | null): string {
  const raw = token.raw ?? token.text ?? "";
  if (isPureHtmlComment(raw)) return "";

  const root = extractRootTagName(raw);

  // Remove whole block element if the token holds exactly one element with a matching tag
  if (root && tagSet.has(root) && isWholeSingleElement(raw, root)) {
    return "";
  }

  // Otherwise, keep token, but strip inline void-like occurrences for matching tags
  const processed = inlineTagPattern ? raw.replace(inlineTagPattern, "") : raw;
  return ensureTrailingNewline(processed);
}

function renderParagraph(token: ParagraphToken, inlineTagPattern: RegExp | null): string {
  let raw = token.raw ?? token.text ?? "";
  raw = stripHtmlCommentsOutsideInlineCode(raw);
  if (inlineTagPattern) raw = raw.replace(inlineTagPattern, "");
  raw = removePureCommentOnlyLines(raw);
  return raw.length ? raw + "\n\n" : "";
}

function renderText(token: TextToken, inlineTagPattern: RegExp | null): string {
  let raw = token.raw ?? token.text ?? "";
  raw = stripHtmlCommentsOutsideInlineCode(raw);
  if (inlineTagPattern) raw = raw.replace(inlineTagPattern, "");
  return ensureTrailingNewline(raw);
}

function renderOther(token: GenericToken, inlineTagPattern: RegExp | null): string {
  const raw = token.raw;
  if (!raw) {
    if (!token.text) return "";
    let t = stripHtmlCommentsOutsideInlineCode(token.text);
    if (inlineTagPattern) t = t.replace(inlineTagPattern, "");
    return ensureTrailingNewline(t);
  }
  let processed = raw;
  if (inlineTagPattern) processed = processed.replace(inlineTagPattern, "");
  processed = stripHtmlCommentsOutsideInlineCode(processed);
  return ensureTrailingNewline(processed);
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : s + "\n";
}

function buildInlineTagPattern(tags: string[]): RegExp {
  // Matches <tag ...> or <tag/> or <tag />
  return new RegExp(`<\\s*(?:${tags.map(escapeRegex).join("|")})(?:\\s+[^>]*)?>\\s*`, "gi");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPureHtmlComment(raw: string): boolean {
  const trimmed = raw.trim();
  return /^<!--[\s\S]*?-->$/.test(trimmed);
}

function extractRootTagName(raw: string): string | null {
  const rootTagRe = /^<\\s*([a-zA-Z0-9:-]+)/;
  const m = rootTagRe.exec(raw);
  return m ? m[1].toLowerCase() : null;
}

function isWholeSingleElement(raw: string, tag: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("<")) return false;
  const openRe = new RegExp(`^<\\s*${escapeRegex(tag)}(?:\\s+[^>]*)?>`, "i");
  const closeRe = new RegExp(`<\\/\\s*${escapeRegex(tag)}\\s*>$`, "i");
  return openRe.test(trimmed) && closeRe.test(trimmed);
}

function stripHtmlCommentsOutsideInlineCode(text: string): string {
  if (!text.includes("<!--")) return text;
  const parts: string[] = [];
  let lastIndex = 0;
  const codeSpanRe = /`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = codeSpanRe.exec(text)) !== null) {
    const before = text.slice(lastIndex, m.index);
    parts.push(removeComments(before));
    parts.push(m[0]);
    lastIndex = m.index + m[0].length;
  }
  parts.push(removeComments(text.slice(lastIndex)));
  return parts.join("");
}

function removeComments(segment: string): string {
  return segment.replace(/<!--[\s\S]*?-->/g, "");
}

function removePureCommentOnlyLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^<!--[\s\S]*?-->$/.test(line.trim()))
    .join("\n")
    .trimEnd();
}
