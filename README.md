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

The `createPlugin` function enables users to create a plugin that will run on Cloudflare Workers environment. It accepts a handler and a manifest.

### `postComment`

Use `context.commentHandler.postComment` to write or update a comment on the triggering issue or pull request.

```typescript
await context.commentHandler.postComment(context, context.logger.ok("Done"));
```

### `callLlm`

The `callLlm` function allows plugins to securely call the ai.ubq.fi LLM endpoint using inherited GitHub authentication.

#### Usage

```typescript
import { createPlugin, callLlm, type Manifest } from '@ubiquity-os/plugin-sdk';

const manifest: Manifest = {
  name: "llm-plugin",
  short_name: "llm",
  description: "LLM demo",
  commands: {
    llm: {
      description: "Query the LLM",
      "ubiquity:example": "/llm hello",
    },
  },
};

export default createPlugin(async (context) => {
  // Non-streaming: resolves to ChatCompletion.
  const result = await callLlm(
    {
      messages: [{ role: "user", content: "Hello, world!" }],
    },
    context
  );

  // Streaming: returns AsyncIterable<ChatCompletionChunk>.
  const stream = await callLlm(
    {
      messages: [{ role: "user", content: "Hello, world!" }],
      stream: true,
    },
    context
  );
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    // handle delta
  }
  return { success: true };
}, manifest);
```

Automatically extracts `authToken`, `owner`, `repo` from input and passes to ai.ubq.fi with proper headers for secure, repo-scoped access.
