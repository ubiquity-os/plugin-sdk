import { describe, expect, it } from "@jest/globals";
import { sanitizeMetadata } from "../src/util";

describe("sanitizeMetadata", () => {
  it("escapes dangerous characters in content fields", () => {
    const obj = {
      message: "<script>alert('xss')</script>",
      status: 200,
    };
    const result = sanitizeMetadata(obj);
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>");
    expect(result).toContain("200");
  });

  it("does not escape stack, callstack, or caller fields", () => {
    const obj = {
      message: "Error occurred",
      stack: "Error: msg\n    at foo (file.js:10:5)\n    at bar (file.js:20:10)",
      callstack: ["foo", "bar"],
      caller: "myFunction",
    };
    const result = sanitizeMetadata(obj);
    // stack should NOT be escaped (no &lt;/&gt;)
    expect(result).toContain('"stack":');
    expect(result).toContain("(file.js:10:5)");
    expect(result).toContain("callstack");
    expect(result).toContain("caller");
    // content message should be escaped if it had special chars
    expect(result).toContain("Error occurred");
  });

  it("handles null/undefined gracefully", () => {
    expect(sanitizeMetadata(null)).toBe("null");
    expect(sanitizeMetadata(undefined)).toBe("null");
  });

  it("escapes double-dash sequences in content", () => {
    const obj = {
      message: "text with -- double dash",
    };
    const result = sanitizeMetadata(obj);
    expect(result).toContain("&#45;&#45;");
  });
});
