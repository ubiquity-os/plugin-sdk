export function sanitizeLlmResponse(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith("```")) {
    let result = trimmed.replace(/^```[a-z0-9+-]*\s*\n?/i, "");

    if (result.endsWith("```")) {
      result = result.slice(0, -3);

      if (result.endsWith("\r")) {
        result = result.slice(0, -1);
      }
    }

    return result.trim();
  }

  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}
