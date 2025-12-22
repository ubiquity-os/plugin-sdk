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

### `postComment`

### `callLlm`

The `callLlm` function allows plugins to securely call the ai.ubq.fi LLM endpoint using inherited GitHub authentication.

#### Usage

```typescript
import { PluginInput, createPlugin, callLlm } from '@ubiquity-os/plugin-sdk';

export default createPlugin({
  async onCommand(input: PluginInput) {
    // Non-streaming: resolves to ChatCompletion.
    const result = await callLlm(
      {
        messages: [{ role: 'user', content: 'Hello, world!' }]
      },
      input
    );

    // Streaming: returns AsyncIterable<ChatCompletionChunk>.
    const stream = await callLlm(
      {
        messages: [{ role: 'user', content: 'Hello, world!' }],
        stream: true
      },
      input
    );
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? '';
      // handle delta
    }
    return { success: true };
  }
});
```

Automatically extracts `authToken`, `owner`, `repo` from input and passes to ai.ubq.fi with proper headers for secure, repo-scoped access.
