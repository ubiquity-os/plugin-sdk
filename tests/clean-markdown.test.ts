import { describe, expect, it } from "@jest/globals";
import { cleanMarkdown } from "../src";

describe("cleanMarkdown", () => {
  it("removes top-level HTML comments", () => {
    const input = `Hello
<!-- remove me -->
World
`;
    const output = cleanMarkdown(input, { tags: [] });
    expect(output).not.toMatch(/remove me/);
    expect(output).toMatch(/Hello/);
    expect(output).toMatch(/World/);
  });

  it("preserves comments inside fenced code blocks", () => {
    const input = "```js\n// code\n<!-- keep me -->\nconsole.log(1);\n```\n";
    const output = cleanMarkdown(input, { tags: [] });
    expect(output).toEqual(input.trimEnd());
  });

  it("preserves comments inside inline code spans", () => {
    const input = "Some `code <!-- keep --> span` text <!-- remove --> done";
    const output = cleanMarkdown(input, { tags: [] });
    expect(output).toContain("`code <!-- keep --> span`");
    expect(output).not.toContain("<!-- remove -->");
  });

  it("removes configured block tag (<details>) entirely", () => {
    const input = `<details>
<summary>Title</summary>
Inner content
</details>
After
`;
    const output = cleanMarkdown(input, { tags: ["details"] });
    expect(output).not.toMatch(/Inner content/);
    expect(output).not.toMatch(/<summary>/);
    expect(output).toMatch(/^After/m);
  });

  it("removes inline void-like tag occurrences (<br>)", () => {
    const input = "Line1<br>\nLine2<br />\nLine3";
    const output = cleanMarkdown(input, { tags: ["br"] });
    expect(output).toBe("Line1\nLine2\nLine3");
  });

  it("preserves inline void-like tags inside inline code", () => {
    const input = "Code span with `<br>` literal and outside <br>";
    const output = cleanMarkdown(input, { tags: ["br"] });
    expect(output).toContain("`<br>`");
    expect(output).not.toMatch(/ outside <br>/); // outside <br> removed
  });

  it("collapses excessive blank lines when collapseEmptyLines enabled", () => {
    const input = "Line1\n\n\n\nLine2\n\n\nLine3";
    const output = cleanMarkdown(input, { collapseEmptyLines: true });
    // No sequences of 3+ newlines remain
    expect(output).not.toMatch(/\n{3,}/);
  });

  it("is idempotent (second pass does not change output)", () => {
    const input = `Text
<!-- comment -->
<details>
<summary>Sum</summary>
Body
</details>
Line<br>
\`\`\`
<!-- inside code -->
\`\`\`
`;
    const once = cleanMarkdown(input, { tags: ["details", "br"] });
    const twice = cleanMarkdown(once, { tags: ["details", "br"] });
    expect(twice).toEqual(once);
  });

  it("handles nested details conservatively (outer removed if single element)", () => {
    const input = `<details>
<summary>Outer</summary>
<details>
<summary>Inner</summary>
Inner body
</details>
</details>
After
`;
    const output = cleanMarkdown(input, { tags: ["details"] });
    // Outer block removed entirely
    expect(output).not.toMatch(/Outer/);
    expect(output).not.toMatch(/Inner body/);
    expect(output).toMatch(/^After/m);
  });

  it("does nothing when no tags and no comments", () => {
    const input = "Plain text\n\nAnother paragraph";
    const output = cleanMarkdown(input);
    expect(output).toEqual(input);
  });
});
