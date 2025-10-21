import { describe, expect, it } from "@jest/globals";
import { sanitizeLlmResponse } from "../src";

describe("sanitizeLlmResponse", () => {
  it("returns plain text unchanged", () => {
    const input = "plain text";
    expect(sanitizeLlmResponse(input)).toBe("plain text");
  });

  it("strips inline backticks", () => {
    const input = "`value`";
    expect(sanitizeLlmResponse(input)).toBe("value");
  });

  it("strips fenced code blocks with language identifiers", () => {
    const input = '```json\n{"a":1}\n```';
    expect(sanitizeLlmResponse(input)).toBe('{"a":1}');
  });

  it("strips fenced code blocks with windows newlines", () => {
    const input = "```\r\nline one\r\n```";
    expect(sanitizeLlmResponse(input)).toBe("line one");
  });
});
