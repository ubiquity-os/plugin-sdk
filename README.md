# `@ubiquity-os/plugin-sdk`

This project provides a software development kit (SDK) for creating plugins using the Ubiquity OS framework. It supports the following features:

- TypeScript
- Creating a plugin instance
- Injection of the context
- Provider with a logger, an authenticated Octokit instance, and the event payload

## Key Functions

### `createActionsPlugin`

The `createActionsPlugin` function allows users to create plugins that will be able to run on GitHub Actions.

### `createPlugin`

The `createPlugin` function enables users to create a plugin that will run on Cloudflare Workers environment.

### `callLlm`

The `callLlm` function sends chat completion requests to `ai.ubq.fi` using the auth token and repository context supplied by the kernel.

### `postComment`

The `postComment` function enables users to easily post a comment to an issue, a pull-request, or a pull request review thread.

## Getting Started

To set up the project locally, `bun` is the preferred package manager.

1. Install the dependencies:

   ```sh
   bun install
   ```

2. Build the SDK
   ```
   bun sdk:build
   ```
3. Link it locally to another plugin
   ```
   bun link
   ```

## Scripts

The project provides several npm scripts for various tasks:

- `bun run sdk:build`: Compiles the TypeScript code.
- `bun run test`: Runs the tests.
- `bun run lint`: Runs the linter.
- `bun run format`: Formats the code using Prettier.

## Testing

### Jest

To start Jest tests, run:

```sh
bun run test
```

## LLM Utility

```ts
import { callLlm } from "@ubiquity-os/plugin-sdk";

const result = await callLlm(
  {
    messages: [{ role: "user", content: "Summarize this issue." }],
  },
  context
);
```

## Markdown Cleaning Utility

`cleanMarkdown` removes top-level HTML comments and configured HTML tags while preserving content inside fenced/indented code blocks, inline code spans, and blockquotes.

### Import

```ts
import { cleanMarkdown, type CleanMarkdownOptions } from "@ubiquity-os/plugin-sdk/markdown";
```

### Options (`CleanMarkdownOptions`)

| Option               | Type                              | Default | Description                                                                                                                                                                                 |
| -------------------- | --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tags`               | `(keyof HTMLElementTagNameMap)[]` | `[]`    | List of HTML tag names to strip. Whole block tokens that are a single matching root element are removed entirely. Inline self-closing/void-like occurrences (e.g. `<br>`) are also removed. |
| `collapseEmptyLines` | `boolean`                         | `false` | Collapses runs of 3+ blank lines down to exactly 2.                                                                                                                                         |

### Behavior Summary

- Strips HTML comments (`<!-- ... -->`) outside protected contexts:
  - Not inside fenced/indented code blocks
  - Not inside inline code spans
  - Not inside blockquotes (blockquote content is left untouched)
- Removes entire HTML block tokens consisting of a single root element whose tag is in `tags`.
- Removes inline occurrences of any tag in `tags` (void/self-closing style).
- Leaves everything else unchanged to minimize diff noise.
- Final output is trimmed (no trailing blank lines).

### Example

```ts
const input = `
<!-- build badge -->
<details>
<summary>Info</summary>
Content inside details
</details>

Paragraph with <br> line break and \`<br>\` in code.

\`\`\`ts
// Code block with <!-- comment --> and <br>
const x = 1;
\`\`\`

> Blockquote with <!-- preserved comment --> and <br>.
`;

const cleaned = cleanMarkdown(input, {
  tags: ["details", "br"],
  collapseEmptyLines: true,
});

console.log(cleaned);
```
